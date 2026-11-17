import test from 'node:test';
import assert from 'node:assert';
import {
  damerauLevenshteinDistance,
  computeDamerauSimilarity,
  checkAntonymConflict,
  resolveTargetCandidate,
  ANTYNOM_VIOLATION,
  ANTONYM_BARRIER_MATRIX,
} from '../src/element-resolver';
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
    rect: { x: 100, y: 50 * id, width: 120, height: 40 },
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
// 1. UNIT TEST THUẬT TOÁN DAMERAU-LEVENSHTEIN DISTANCE
// -------------------------------------------------------------
test('Damerau-Levenshtein: Hoán vị 2 ký tự kế cận (Adjacent Transposition)', () => {
  // "sign ni" <-> "sign in": hoán vị 'ni' <-> 'in' => distance = 1
  const dist1 = damerauLevenshteinDistance('sign ni', 'sign in');
  assert.strictEqual(dist1, 1, '"sign ni" vs "sign in" phải có khoảng cách bằng 1');

  // "submti" <-> "submit": hoán vị 'ti' <-> 'it' => distance = 1
  const dist2 = damerauLevenshteinDistance('submti', 'submit');
  assert.strictEqual(dist2, 1, '"submti" vs "submit" phải có khoảng cách bằng 1');

  // "usernmae" <-> "username": hoán vị 'ma' <-> 'am' => distance = 1
  const dist3 = damerauLevenshteinDistance('usernmae', 'username');
  assert.strictEqual(dist3, 1, '"usernmae" vs "username" phải có khoảng cách bằng 1');
});

test('Damerau-Levenshtein: Xóa và Chèn ký tự (Deletion / Insertion)', () => {
  // "delte" <-> "delete": thiếu 1 chữ 'e' => distance = 1
  const dist = damerauLevenshteinDistance('delte', 'delete');
  assert.strictEqual(dist, 1, '"delte" vs "delete" phải có khoảng cách bằng 1');
});

test('Damerau-Levenshtein: Tính toán khoảng cách chuẩn hóa và Self-Healing Threshold', () => {
  // Sim = 1 - (dist / max(len1, len2))
  const sim1 = computeDamerauSimilarity('sign ni', 'Sign In');
  assert.strictEqual(sim1.distance, 1);
  assert.ok(sim1.similarity >= 0.75, `Sim (${sim1.similarity}) phải >= 0.75`);
  assert.strictEqual(sim1.isAcceptable, true, 'Phải thỏa mãn điều kiện Self-Healing');

  const sim2 = computeDamerauSimilarity('delte', 'Delete');
  assert.strictEqual(sim2.distance, 1);
  assert.ok(sim2.similarity >= 0.75, `Sim (${sim2.similarity}) phải >= 0.75`);
  assert.strictEqual(sim2.isAcceptable, true);

  const sim3 = computeDamerauSimilarity('submti', 'Submit');
  assert.strictEqual(sim3.distance, 1);
  assert.ok(sim3.similarity >= 0.75, `Sim (${sim3.similarity}) phải >= 0.75`);
  assert.strictEqual(sim3.isAcceptable, true);
});

// -------------------------------------------------------------
// 2. UNIT TEST HÀNG RÀO TỪ TRÁI NGHĨA (ANTONYM BARRIER MATRIX)
// -------------------------------------------------------------
test('Antonym Barrier: Nhận diện xung đột các cặp từ đối lập nghiêm ngặt', () => {
  const strictPairs: [string, string][] = [
    ['sign in', 'sign out'],
    ['login', 'logout'],
    ['log in', 'log out'],
    ['delete', 'save'],
    ['remove', 'add'],
    ['cancel', 'confirm'],
    ['accept', 'reject'],
    ['enable', 'disable'],
    ['agree', 'decline'],
  ];

  for (const [poleA, poleB] of strictPairs) {
    const resAB = checkAntonymConflict(poleA, poleB);
    assert.strictEqual(
      resAB.hasConflict,
      true,
      `Cặp ("${poleA}", "${poleB}") phải kích hoạt Antonym Conflict`
    );
    assert.strictEqual(resAB.violationCode, ANTYNOM_VIOLATION);

    const resBA = checkAntonymConflict(poleB, poleA);
    assert.strictEqual(
      resBA.hasConflict,
      true,
      `Cặp ("${poleB}", "${poleA}") phải kích hoạt Antonym Conflict`
    );
    assert.strictEqual(resBA.violationCode, ANTYNOM_VIOLATION);
  }
});

test('Antonym Barrier: Hỗ trợ các cặp từ đối lập tiếng Việt', () => {
  const vnPairs: [string, string][] = [
    ['đăng nhập', 'đăng xuất'],
    ['xóa', 'lưu'],
    ['hủy', 'xác nhận'],
    ['bật', 'tắt'],
    ['đồng ý', 'từ chối'],
  ];

  for (const [poleA, poleB] of vnPairs) {
    const res = checkAntonymConflict(poleA, poleB);
    assert.strictEqual(
      res.hasConflict,
      true,
      `Cặp tiếng Việt ("${poleA}", "${poleB}") phải kích hoạt Antonym Conflict`
    );
  }
});

test('Antonym Barrier: Cùng cực ngữ nghĩa không được báo lỗi xung đột', () => {
  assert.strictEqual(checkAntonymConflict('sign in', 'Sign In').hasConflict, false);
  assert.strictEqual(checkAntonymConflict('sign in', 'login').hasConflict, false);
  assert.strictEqual(checkAntonymConflict('save', 'Lưu').hasConflict, false);
  assert.strictEqual(checkAntonymConflict('cancel', 'Hủy').hasConflict, false);
});

test('Antonym Barrier: Nhận diện xung đột ngay cả khi Target bị gõ sai chính tả (Typo Target)', () => {
  // "sign ni" (typo của "sign in") đối lập với "Sign Out"
  const res = checkAntonymConflict('sign ni', 'Sign Out');
  assert.strictEqual(res.hasConflict, true, '"sign ni" đối lập với "Sign Out" phải bị chặn');
  assert.strictEqual(res.violationCode, ANTYNOM_VIOLATION);
});

// -------------------------------------------------------------
// 3. INTEGRATION TESTS (4 YÊU CẦU CỦA PROMPT 01)
// -------------------------------------------------------------
test('Prompt 01 - Yêu cầu 1: "sign ni" phải map thành công vào "Sign In" (distance = 1, transposition)', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Sign In'),
    createMockCandidate(2, 'Cancel'),
    createMockCandidate(3, 'Help Center'),
  ];

  const action = createMockAction('sign ni', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.ok(result.candidate, 'Phải tìm thấy candidate');
  assert.strictEqual(result.candidate?.candidateId, 1, 'Phải map chính xác vào nút "Sign In" (ID 1)');
  assert.strictEqual(result.candidate?.text, 'Sign In');
  assert.strictEqual(result.matchSource, 'FUZZY_HEALED', 'Nguồn match phải là FUZZY_HEALED');
  assert.strictEqual(result.damerauDistance, 1, 'Khoảng cách Damerau phải bằng 1');
});

test('Prompt 01 - Yêu cầu 2: "Sign In" tuyệt đối không được map vào "Sign Out"', async () => {
  // Giao diện chỉ có nút "Sign Out", tuyệt đối không được bấm nhầm
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Sign Out'),
    createMockCandidate(2, 'User Settings'),
  ];

  const action = createMockAction('Sign In', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.strictEqual(
    result.candidate,
    null,
    '"Sign In" tuyệt đối không được map vào "Sign Out", candidate phải là null'
  );
  assert.strictEqual(
    result.flag,
    ANTYNOM_VIOLATION,
    'Phải gắn cờ vi phạm ANTYNOM_VIOLATION'
  );
});

test('Prompt 01 - Yêu cầu 2 mở rộng: "sign ni" (typo) tuyệt đối không map vào "Sign Out" khi chỉ có "Sign Out"', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Sign Out'),
  ];

  const action = createMockAction('sign ni', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.strictEqual(result.candidate, null, 'Typo "sign ni" cũng không được map vào "Sign Out"');
  assert.strictEqual(result.flag, ANTYNOM_VIOLATION);
});

test('Prompt 01 - Yêu cầu 2 mở rộng: Khi có cả "Sign In" và "Sign Out", "sign ni" phải chọn "Sign In" và loại bỏ "Sign Out"', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Sign Out'),
    createMockCandidate(2, 'Sign In'),
  ];

  const action = createMockAction('sign ni', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.ok(result.candidate, 'Phải tìm thấy candidate');
  assert.strictEqual(result.candidate?.candidateId, 2, 'Phải chọn "Sign In" (ID 2)');
  assert.strictEqual(result.candidate?.text, 'Sign In');
});

test('Prompt 01 - Yêu cầu 3: "delte" phải map thành công vào "Delete"', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Cancel'),
    createMockCandidate(2, 'Delete'),
    createMockCandidate(3, 'Save Draft'),
  ];

  const action = createMockAction('delte', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.ok(result.candidate, 'Phải tìm thấy candidate');
  assert.strictEqual(result.candidate?.candidateId, 2, 'Phải map chính xác vào nút "Delete" (ID 2)');
  assert.strictEqual(result.candidate?.text, 'Delete');
  assert.strictEqual(result.matchSource, 'FUZZY_HEALED');
  assert.strictEqual(result.damerauDistance, 1);
});

test('Prompt 01 - Yêu cầu 4: "submti" phải map thành công vào "Submit"', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Reset Form'),
    createMockCandidate(2, 'Submit'),
    createMockCandidate(3, 'Cancel'),
  ];

  const action = createMockAction('submti', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.ok(result.candidate, 'Phải tìm thấy candidate');
  assert.strictEqual(result.candidate?.candidateId, 2, 'Phải map chính xác vào nút "Submit" (ID 2)');
  assert.strictEqual(result.candidate?.text, 'Submit');
  assert.strictEqual(result.matchSource, 'FUZZY_HEALED');
  assert.strictEqual(result.damerauDistance, 1);
});

test('Prompt 01 - Yêu cầu bổ sung: "delte" tuyệt đối không được map vào "Save"', async () => {
  const candidates: DOMCandidate[] = [
    createMockCandidate(1, 'Save'),
  ];

  const action = createMockAction('delte', 'CLICK');
  const result = await resolveTargetCandidate('https://example.com', action, candidates);

  assert.strictEqual(
    result.candidate,
    null,
    '"delte" (delete) tuyệt đối không được map vào "Save"'
  );
  assert.strictEqual(result.flag, ANTYNOM_VIOLATION);
});
