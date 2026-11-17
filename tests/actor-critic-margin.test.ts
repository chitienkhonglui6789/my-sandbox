import test from 'node:test';
import assert from 'node:assert';
import {
  computeSafetyMargin,
  resolveTargetCandidate,
  checkAntonymConflict,
} from '../src/element-resolver';
import { LLMBridge } from '../src/llm-bridge';
import { AtomicAction, DOMCandidate } from '../src/types';

function createMockCandidate(
  id: number,
  text: string,
  tag: string = 'button',
  extra: Partial<DOMCandidate> = {}
): DOMCandidate {
  return {
    candidateId: id,
    tag,
    text,
    disabled: false,
    obscured: false,
    rect: { x: 100, y: 60 * id, width: 140, height: 40 },
    selectorPath: `${tag}#btn-${id}`,
    fingerprint: {
      tag,
      text,
      stableClasses: ['btn', 'btn-primary'],
      selectorPath: `${tag}#btn-${id}`,
    },
    ...extra,
  };
}

function createMockAction(targetHint: string, type: any = 'CLICK'): AtomicAction {
  return {
    stepNumber: 1,
    subIndex: 1,
    totalSubActions: 1,
    rawStepText: `Bấm nút "${targetHint}"`,
    subInstruction: `Bấm nút "${targetHint}"`,
    type,
    targetHint,
  };
}

// -------------------------------------------------------------
// 1. TRỤ CỘT 3: TÍNH TOÁN SAFETY MARGIN (DELTA MARGIN >= 20%)
// -------------------------------------------------------------
test('Safety Margin: Đủ điều kiện độc tôn (Top1 >= 85% và Delta >= 20%) -> Không bị Ambiguous', () => {
  // Top 1 = 100 (100%), Top 2 = 60 (60%) -> Delta = 40% >= 20%
  const res1 = computeSafetyMargin(100, 60);
  assert.strictEqual(res1.top1Norm, 1.0);
  assert.strictEqual(res1.top2Norm, 0.60);
  assert.strictEqual(res1.deltaMargin, 0.40);
  assert.strictEqual(res1.isAmbiguous, false, 'Delta 40% và Top1 100% phải rõ ràng (isAmbiguous = false)');

  // Top 1 = 85 (85%), Top 2 = 65 (65%) -> Delta = 20% == 20%
  const res2 = computeSafetyMargin(85, 65);
  assert.strictEqual(res2.deltaMargin, 0.20);
  assert.strictEqual(res2.isAmbiguous, false, 'Delta 20% và Top1 85% vừa đủ điều kiện an toàn');

  // Chỉ có 1 ứng viên duy nhất: Top 1 = 95, Top 2 = 0
  const res3 = computeSafetyMargin(95, 0);
  assert.strictEqual(res3.deltaMargin, 0.95);
  assert.strictEqual(res3.isAmbiguous, false, 'Ứng viên đơn lẻ điểm cao không bị ambiguous');
});

test('Safety Margin: Delta Margin < 20% -> Bị đánh dấu AMBIGUOUS', () => {
  // Top 1 = 90, Top 2 = 75 -> Delta = 15% < 20%
  const res1 = computeSafetyMargin(90, 75);
  assert.strictEqual(res1.deltaMargin, 0.15);
  assert.strictEqual(res1.isAmbiguous, true, 'Delta 15% < 20% phải bị đánh dấu AMBIGUOUS');

  // Tie (hòa điểm): Top 1 = 85, Top 2 = 85 -> Delta = 0% < 20%
  const res2 = computeSafetyMargin(85, 85);
  assert.strictEqual(res2.deltaMargin, 0);
  assert.strictEqual(res2.isAmbiguous, true, 'Hòa điểm Delta = 0% phải bị AMBIGUOUS');
});

test('Safety Margin: Top 1 < 85% -> Bị đánh dấu AMBIGUOUS ngay cả khi Delta >= 20%', () => {
  // Top 1 = 80, Top 2 = 50 -> Delta = 30% >= 20%, nhưng Top 1 chỉ 80% (< 85%)
  const res = computeSafetyMargin(80, 50);
  assert.strictEqual(res.deltaMargin, 0.30);
  assert.strictEqual(res.isAmbiguous, true, 'Top 1 < 85% phải kích hoạt kiểm tra Actor-Critic');
});

// -------------------------------------------------------------
// 2. FAST-PATH HEURISTIC BYPASS (0ms) KHI BIÊN AN TOÀN RÕ RÀNG
// -------------------------------------------------------------
test('Fast-path: Chấp nhận tức thì ứng viên độc tôn khi Delta Margin >= 20% và Điểm >= 85%', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Xác nhận đặt hàng', 'button'),
    createMockCandidate(2, 'Trợ giúp', 'button'),
    createMockCandidate(3, 'Chính sách', 'button'),
  ];
  const action = createMockAction('Xác nhận đặt hàng');

  const res = await resolveTargetCandidate('http://localhost/test', action, candidates);

  assert.ok(res.candidate, 'Phải tìm thấy ứng viên');
  assert.strictEqual(res.candidate?.candidateId, 1);
  assert.strictEqual(res.matchSource, 'SEMANTIC_RULE');
  assert.strictEqual(res.criticVerdict, 'APPROVED');
  assert.ok((res.deltaMargin ?? 0) >= 0.20, `Delta Margin phải >= 20%, thực tế: ${res.deltaMargin}`);
});

// -------------------------------------------------------------
// 3. ACTOR-CRITIC PIPELINE: CRITIC PHỦ QUYẾT (VETO)
// -------------------------------------------------------------
test('Actor-Critic: Critic Phủ quyết (REJECTED) -> Hủy thao tác, gắn cờ AMBIGUOUS_TARGET', async () => {
  // Hai ứng viên có điểm số sát nhau (Delta < 20% -> Kích hoạt Actor-Critic)
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Đăng nhập bằng Google', 'button'),
    createMockCandidate(2, 'Đăng nhập bằng Email', 'button'),
  ];
  const action = createMockAction('Đăng nhập');

  // Mock Actor đề xuất candidate 1 nhưng Critic nhận diện sai ngữ cảnh và Veto
  const originalRunPipeline = LLMBridge.runActorCriticPipeline;
  try {
    LLMBridge.runActorCriticPipeline = async () => {
      return {
        candidate: null,
        actorProposal: { candidateId: 1, confidence: 0.7, reasoning: 'Actor đề xuất Google' },
        criticEvaluation: {
          verdict: 'REJECTED',
          confidence: 0.95,
          reasoning: 'Critic Veto: Nút "Đăng nhập bằng Google" có nguy cơ mở popup OAuth bên ngoài, không an toàn',
        },
        verdict: 'REJECTED',
        isVetoed: true,
        reasoning: '[CRITIC VETO] Đề xuất bị Critic phủ quyết vì nguy cơ sai ngữ cảnh.',
      };
    };

    const res = await resolveTargetCandidate('http://localhost/test', action, candidates);

    assert.strictEqual(res.candidate, null, 'Hành động phải bị hủy bỏ khi Critic REJECTED');
    assert.strictEqual(res.flag, 'AMBIGUOUS_TARGET', 'Phải gắn cờ AMBIGUOUS_TARGET');
    assert.strictEqual(res.criticVerdict, 'REJECTED');
    assert.ok(res.reasoning?.includes('CRITIC VETO'), 'Reasoning phải ghi nhận quyết định của Critic');
  } finally {
    LLMBridge.runActorCriticPipeline = originalRunPipeline;
  }
});

// -------------------------------------------------------------
// 4. ACTOR-CRITIC PIPELINE: CRITIC PHÊ DUYỆT (APPROVED)
// -------------------------------------------------------------
test('Actor-Critic: Critic Phê duyệt (APPROVED) -> Chấp nhận phần tử do Actor đề xuất với matchSource: LLM', async () => {
  // Hai ứng viên cạnh tranh sát nút (Delta < 20% -> Kích hoạt Actor-Critic)
  const candidates: DOMCandidate[] = [
    createMockCandidate(10, 'Xác nhận thanh toán qua MoMo', 'button'),
    createMockCandidate(20, 'Xác nhận thanh toán qua VNPAY', 'button'),
  ];
  const action = createMockAction('Xác nhận thanh toán');

  const originalRunPipeline = LLMBridge.runActorCriticPipeline;
  try {
    LLMBridge.runActorCriticPipeline = async () => {
      return {
        candidate: candidates[1], // Candidate 20 (VNPAY)
        actorProposal: { candidateId: 20, confidence: 0.92, reasoning: 'Chọn cổng thanh toán VNPAY' },
        criticEvaluation: {
          verdict: 'APPROVED',
          confidence: 0.95,
          reasoning: 'Chính xác là nút Xác nhận thanh toán VNPAY, an toàn tuyệt đối',
        },
        verdict: 'APPROVED',
        isVetoed: false,
        reasoning: 'Actor đề xuất VNPAY [Critic Approved]',
      };
    };

    const res = await resolveTargetCandidate('http://localhost/test', action, candidates);

    assert.ok(res.candidate, 'Phải tìm thấy phần tử khi Critic APPROVED');
    assert.strictEqual(res.candidate?.candidateId, 20);
    assert.strictEqual(res.matchSource, 'LLM');
    assert.strictEqual(res.criticVerdict, 'APPROVED');
    assert.strictEqual(res.confidence, 0.92);
  } finally {
    LLMBridge.runActorCriticPipeline = originalRunPipeline;
  }
});

// -------------------------------------------------------------
// 5. ANTYNOM BARRIER BẢO VỆ KÉP BÊN TRONG ACTOR-CRITIC
// -------------------------------------------------------------
test('Actor-Critic: Nếu Actor đề xuất nút đối lập (Hallucination) -> Bị Antonym Barrier chặn đứng và gắn cờ ANTYNOM_VIOLATION', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Sign In', 'button'),
    createMockCandidate(2, 'Sign Out', 'button'),
  ];
  const action = createMockAction('Sign In');

  // Giả sử Actor bị ảo giác và đề xuất nhầm nút Sign Out (id=2), và Critic lỏng lẻo phê duyệt nhầm
  const originalRunPipeline = LLMBridge.runActorCriticPipeline;
  try {
    LLMBridge.runActorCriticPipeline = async () => {
      return {
        candidate: candidates[1], // Sign Out
        actorProposal: { candidateId: 2, confidence: 0.9, reasoning: 'Hallucinated pick' },
        criticEvaluation: { verdict: 'APPROVED', confidence: 0.9, reasoning: 'Fake approved' },
        verdict: 'APPROVED',
        isVetoed: false,
        reasoning: 'Hallucination test',
      };
    };

    const res = await resolveTargetCandidate('http://localhost/test', action, candidates);

    // Lưu ý: Lúc này Fast-path đã tự chọn "Sign In" (vì Sign Out bị điểm 0 do Antonym check ban đầu)!
    // Nhưng nếu chỉ có Sign Out và Actor đề xuất Sign Out:
    const onlySignOutCandidates = [createMockCandidate(2, 'Sign Out', 'button')];
    const resOnlySignOut = await resolveTargetCandidate('http://localhost/test', action, onlySignOutCandidates);

    assert.strictEqual(resOnlySignOut.candidate, null, 'Tuyệt đối không được chấp nhận nút Sign Out cho lệnh Sign In');
    assert.strictEqual(resOnlySignOut.flag, 'ANTYNOM_VIOLATION');
  } finally {
    LLMBridge.runActorCriticPipeline = originalRunPipeline;
  }
});

// -------------------------------------------------------------
// 6. AMBIGUOUS DEAD TIE FALLBACK (HAI ỨNG VIÊN BẰNG ĐIỂM KHI KHÔNG CÓ AI)
// -------------------------------------------------------------
test('Ambiguous Tie: Khi hai ứng viên có điểm số bằng nhau (Delta = 0) và không có AI -> Thất bại an toàn với AMBIGUOUS_TARGET', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Download file PDF', 'button'),
    createMockCandidate(2, 'Download file PDF', 'button'),
  ];
  const action = createMockAction('Download file PDF');

  // Giả lập LLM offline (trả về NO_CANDIDATE)
  const originalRunPipeline = LLMBridge.runActorCriticPipeline;
  try {
    LLMBridge.runActorCriticPipeline = async () => {
      return {
        candidate: null,
        actorProposal: null,
        criticEvaluation: null,
        verdict: 'NO_CANDIDATE',
        reasoning: 'LLM offline',
      };
    };

    const res = await resolveTargetCandidate('http://localhost/test', action, candidates);

    assert.strictEqual(res.candidate, null, 'Hòa điểm tuyệt đối không được click bừa');
    assert.strictEqual(res.flag, 'AMBIGUOUS_TARGET', 'Phải gắn cờ AMBIGUOUS_TARGET');
    assert.strictEqual(res.deltaMargin, 0, 'Delta Margin phải bằng 0%');
  } finally {
    LLMBridge.runActorCriticPipeline = originalRunPipeline;
  }
});

// -------------------------------------------------------------
// 7. LLM BRIDGE ACTOR & CRITIC PROMPT & PARSER UNIT TESTS
// -------------------------------------------------------------
test('LLMBridge: resolveElementWithActor phân tích JSON hợp lệ kèm Markdown fenced code blocks', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(101, 'Nút A', 'button'),
    createMockCandidate(102, 'Nút B', 'button'),
  ];

  const originalQuery = LLMBridge.query;
  try {
    LLMBridge.query = async () => {
      return '```json\n{\n  "candidateId": 102,\n  "confidence": 0.94,\n  "reasoning": "Nút B khớp chính xác với ngữ cảnh"\n}\n```';
    };

    const proposal = await LLMBridge.resolveElementWithActor(
      'Bấm nút B',
      'CLICK',
      'Nút B',
      candidates
    );

    assert.ok(proposal, 'Phải phân tích được proposal từ JSON');
    assert.strictEqual(proposal?.candidateId, 102);
    assert.strictEqual(proposal?.confidence, 0.94);
    assert.strictEqual(proposal?.reasoning, 'Nút B khớp chính xác với ngữ cảnh');
  } finally {
    LLMBridge.query = originalQuery;
  }
});

test('LLMBridge: evaluateProposalWithCritic nhận diện và xử lý phán quyết REJECTED', async () => {
  const candidate = createMockCandidate(101, 'Delete All Account Data', 'button');

  const originalQuery = LLMBridge.query;
  try {
    LLMBridge.query = async () => {
      return JSON.stringify({
        verdict: 'REJECTED',
        confidence: 0.98,
        reasoning: 'Nguy cơ xóa toàn bộ dữ liệu người dùng, đối lập với hành động Save',
      });
    };

    const evalResult = await LLMBridge.evaluateProposalWithCritic(
      'Lưu thông tin',
      'CLICK',
      'Save',
      candidate
    );

    assert.strictEqual(evalResult.verdict, 'REJECTED');
    assert.strictEqual(evalResult.confidence, 0.98);
    assert.ok(evalResult.reasoning.includes('xóa toàn bộ'));
  } finally {
    LLMBridge.query = originalQuery;
  }
});

test('LLMBridge: runActorCriticPipeline tích hợp 2 tầng Actor đề xuất và Critic Veto', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(201, 'Sign Out', 'button'),
    createMockCandidate(202, 'Profile', 'button'),
  ];

  let queryCallCount = 0;
  const originalQuery = LLMBridge.query;
  try {
    LLMBridge.query = async (prompt: string) => {
      queryCallCount++;
      if (prompt.includes('Actor Model')) {
        return JSON.stringify({
          candidateId: 201,
          confidence: 0.88,
          reasoning: 'Actor đề xuất candidate 201',
        });
      }
      if (prompt.includes('Critic Model')) {
        return JSON.stringify({
          verdict: 'REJECTED',
          confidence: 0.99,
          reasoning: 'Critic Veto: Nút Sign Out đối lập với ý định Sign In',
        });
      }
      return null;
    };

    const pipelineRes = await LLMBridge.runActorCriticPipeline(
      'Sign In',
      'CLICK',
      'Sign In',
      candidates
    );

    assert.strictEqual(pipelineRes.verdict, 'REJECTED');
    assert.strictEqual(pipelineRes.isVetoed, true);
    assert.strictEqual(pipelineRes.candidate, null);
    assert.strictEqual(pipelineRes.actorProposal?.candidateId, 201);
    assert.strictEqual(pipelineRes.criticEvaluation?.verdict, 'REJECTED');
    assert.ok(pipelineRes.reasoning.includes('CRITIC VETO'));
    assert.strictEqual(queryCallCount, 2, 'Phải gọi đủ cả 2 tầng Actor và Critic');
  } finally {
    LLMBridge.query = originalQuery;
  }
});
