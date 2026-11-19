import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { AtomicAction, DOMCandidate } from './types';

// Tự động nạp file .env nếu có
try {
  const envFile = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
    for (const l of lines) {
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}

export interface ActorProposal {
  candidateId: number | null;
  confidence: number;
  reasoning: string;
}

export interface CriticEvaluation {
  verdict: 'APPROVED' | 'REJECTED';
  confidence: number;
  reasoning: string;
}

export interface ActorCriticResult {
  candidate: DOMCandidate | null;
  actorProposal: ActorProposal | null;
  criticEvaluation: CriticEvaluation | null;
  verdict: 'APPROVED' | 'REJECTED' | 'NO_CANDIDATE';
  reasoning: string;
  isVetoed?: boolean;
}

export interface VisionSoMRequest {
  imageBase64: string;
  action: string;
  targetHint: string;
  markCount: number;
  prompt: string;
  validMarkIds: number[];
}

export interface VisionSoMProviderResponse {
  id: number | string | null;
  reason?: string;
  rawResponse?: string;
  provider?: string;
}

export type VisionSoMProvider = (
  request: VisionSoMRequest
) => Promise<VisionSoMProviderResponse | string | null>;

export interface AskGeminiVisionSoMOptions {
  /** Pluggable multimodal provider (dùng cho test offline hoặc custom backend) */
  provider?: VisionSoMProvider;
  /** Danh sách ID hợp lệ (mặc định 1..markCount) */
  validMarkIds?: number[];
  /** Ghi đè tên model Gemini Multimodal */
  model?: string;
  /** Ghi đè Gemini API key (mặc định process.env.GEMINI_API_KEY) */
  apiKey?: string;
  /** Thời gian chờ tối đa (ms) */
  timeoutMs?: number;
  /** Custom fetch để test payload HTTP mà không cần gọi mạng thật */
  fetchFn?: typeof fetch;
}

export interface VisionSoMResult {
  /** ID số nguyên hợp lệ trong tập SoM, hoặc null nếu bị từ chối / không khả dụng */
  id: number | null;
  /** Lý do lựa chọn hoặc lý do từ chối */
  reason: string;
  /** Có gọi tới AI API / Multimodal provider hay không */
  apiCalled: boolean;
  /** ID trả về có vượt qua bộ lọc chống ảo giác hợp lệ hay không */
  valid: boolean;
  /** Cờ báo hiệu đã chặn phản hồi ảo giác (out-of-range / không phải số nguyên / tọa độ giả) */
  rejectedHallucination?: boolean;
  /** Giá trị ID thô AI trả về trước khi kiểm duyệt */
  rawReturnedId?: unknown;
  /** Nguồn xử lý ('custom-provider' | 'gemini-multimodal' | 'none') */
  provider: string;
  /** Chuỗi prompt chuẩn đã gửi đi */
  prompt: string;
  /** Độ trễ thực thi (ms) */
  latencyMs: number;
}

/**
 * Tạo prompt chuẩn Prompt 14 (Set-of-Marks Visual Indexing) gửi tới Gemini Multimodal API.
 */
export function buildVisionSoMPrompt(
  action: string,
  targetHint: string,
  markCount: number
): string {
  const safeAction = (action || 'CLICK').trim();
  const safeTarget = (targetHint || '').trim();
  return (
    `Để thực hiện hành động [${safeAction}] trên mục tiêu [${safeTarget}], hãy chọn ID số mấy? ` +
    `Chỉ trả về JSON {"id": <number>, "reason": "..."} ` +
    `(ID hợp lệ từ 1 đến ${markCount}, hoặc null nếu không tìm thấy; tuyệt đối không tự đoán tọa độ pixel).`
  );
}

/**
 * Bộ phân tích và kiểm duyệt nghiêm ngặt Mark ID trả về từ Multimodal Vision AI.
 * Chỉ chấp nhận duy nhất số nguyên nằm trong tập validIds -> Triệt tiêu 100% ảo giác tọa độ pixel.
 */
export function parseAndValidateSoMMarkId(
  rawResponse: VisionSoMProviderResponse | string | null,
  validIds: Set<number>,
  markCount: number
): {
  id: number | null;
  reason: string;
  valid: boolean;
  rejectedHallucination: boolean;
  rawReturnedId?: unknown;
} {
  if (rawResponse === null || rawResponse === undefined) {
    return {
      id: null,
      reason: 'Multimodal provider không trả về phản hồi',
      valid: false,
      rejectedHallucination: false,
    };
  }

  let rawId: unknown = undefined;
  let parsedReason = '';

  if (typeof rawResponse === 'string') {
    const trimmed = rawResponse.trim();
    if (!trimmed) {
      return {
        id: null,
        reason: 'Phản hồi Multimodal trống',
        valid: false,
        rejectedHallucination: false,
      };
    }

    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsedObj: any = null;
    try {
      parsedObj = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedObj = JSON.parse(jsonMatch[0]);
        } catch {
          parsedObj = null;
        }
      }
    }

    if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
      const hasIdProp =
        Object.prototype.hasOwnProperty.call(parsedObj, 'id') ||
        Object.prototype.hasOwnProperty.call(parsedObj, 'markId');
      if (!hasIdProp) {
        return {
          id: null,
          reason: `[ANTI-HALLUCINATION] Phản hồi JSON thiếu trường "id" hợp lệ (nghi vấn ảo giác tọa độ/selector): "${cleaned.slice(0, 120)}"`,
          valid: false,
          rejectedHallucination: true,
          rawReturnedId: parsedObj,
        };
      }
      rawId = Object.prototype.hasOwnProperty.call(parsedObj, 'id')
        ? parsedObj.id
        : parsedObj.markId;
      parsedReason =
        typeof parsedObj.reason === 'string'
          ? parsedObj.reason
          : typeof parsedObj.reasoning === 'string'
            ? parsedObj.reasoning
            : '';
    } else if (/^\[?\s*-?\d+(?:\.\d+)?\s*\]?$/.test(cleaned)) {
      const numMatch = cleaned.match(/-?\d+(?:\.\d+)?/);
      rawId = numMatch ? Number(numMatch[0]) : cleaned;
      parsedReason = 'AI trả về trực tiếp mã số Mark ID';
    } else {
      return {
        id: null,
        reason: `[ANTI-HALLUCINATION] Phản hồi không chứa JSON Mark ID hợp lệ: "${cleaned.slice(0, 120)}"`,
        valid: false,
        rejectedHallucination: true,
        rawReturnedId: cleaned,
      };
    }
  } else if (typeof rawResponse === 'object') {
    const respObj = rawResponse as unknown as Record<string, unknown>;
    const hasIdProp =
      Object.prototype.hasOwnProperty.call(respObj, 'id') ||
      Object.prototype.hasOwnProperty.call(respObj, 'markId');
    if (!hasIdProp) {
      return {
        id: null,
        reason: `[ANTI-HALLUCINATION] Phản hồi object thiếu trường "id" hợp lệ (nghi vấn ảo giác tọa độ/selector).`,
        valid: false,
        rejectedHallucination: true,
        rawReturnedId: rawResponse,
      };
    }
    rawId = Object.prototype.hasOwnProperty.call(respObj, 'id')
      ? respObj.id
      : respObj.markId;
    parsedReason = typeof respObj.reason === 'string' ? respObj.reason : '';
  }

  if (rawId === null) {
    return {
      id: null,
      reason: parsedReason || 'AI xác nhận không tìm thấy mục tiêu phù hợp trên ảnh SoM',
      valid: false,
      rejectedHallucination: false,
      rawReturnedId: null,
    };
  }

  if (rawId === undefined) {
    return {
      id: null,
      reason: '[ANTI-HALLUCINATION] Trường "id" bị thiếu (undefined) trong phản hồi Vision SoM.',
      valid: false,
      rejectedHallucination: true,
      rawReturnedId: undefined,
    };
  }

  let numericId: number | null = null;
  if (typeof rawId === 'number') {
    if (Number.isInteger(rawId)) {
      numericId = rawId;
    }
  } else if (typeof rawId === 'string') {
    const cleanStr = rawId.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    if (/^\d+$/.test(cleanStr)) {
      numericId = Number.parseInt(cleanStr, 10);
    }
  }

  if (numericId === null || !Number.isInteger(numericId) || !validIds.has(numericId)) {
    return {
      id: null,
      reason: `[ANTI-HALLUCINATION] Từ chối Mark ID không hợp lệ (${JSON.stringify(rawId)}; phạm vi hợp lệ: 1..${markCount}) để chống ảo giác tọa độ.`,
      valid: false,
      rejectedHallucination: true,
      rawReturnedId: rawId,
    };
  }

  return {
    id: numericId,
    reason: parsedReason || `Vision SoM chọn chính xác Mark [${numericId}]`,
    valid: true,
    rejectedHallucination: false,
    rawReturnedId: rawId,
  };
}

/**
 * UNIVERSAL LLM BRIDGE (AI-FIRST MULTIMODAL EDITION)
 * Cầu nối AI thông minh 4 tầng để giải quyết bài toán trên BẤT KỲ trang web thực tế nào:
 * - Tầng 1: REST API Gemini Flash / Flash-Lite (Multimodal Image + DOM reasoning).
 * - Tầng 2: REST API OpenAI (gpt-4o / gpt-4o-mini).
 * - Tầng 3: Local Ollama (http://localhost:11434).
 * - Tầng 4: Native AGY CLI (C:\Users\lurkh\.gemini\bin\agy.exe).
 */
export class LLMBridge {
  private static agyPath: string | null = null;
  private static customVisionSoMProvider: VisionSoMProvider | null = null;

  /**
   * Đăng ký provider Multimodal Vision SoM tùy chỉnh (hỗ trợ test offline deterministic với chi phí $0).
   */
  public static setVisionSoMProvider(provider: VisionSoMProvider | null): void {
    this.customVisionSoMProvider = provider;
  }

  public static getVisionSoMProvider(): VisionSoMProvider | null {
    return this.customVisionSoMProvider;
  }

  private static getAgyExePath(): string | null {
    if (this.agyPath !== null) return this.agyPath;
    const envPath = process.env.ANTIGRAVITY_AGENTAPI_EXE;
    if (envPath && fs.existsSync(envPath)) {
      this.agyPath = envPath;
      return this.agyPath;
    }
    const defaultWin = 'C:\\Users\\lurkh\\.gemini\\bin\\agy.exe';
    if (fs.existsSync(defaultWin)) {
      this.agyPath = defaultWin;
      return this.agyPath;
    }
    return null;
  }

  /**
   * Gọi LLM thông qua engine phù hợp nhất đang có sẵn (hỗ trợ cả text lẫn multimodal image base64).
   */
  public static async query(
    prompt: string,
    maxWaitMs = 15000,
    imageBase64?: string
  ): Promise<string | null> {
    // 1. Kiểm tra biến môi trường Gemini API Key
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

    if (geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
        const parts: any[] = [{ text: prompt }];

        if (imageBase64) {
          parts.push({
            inlineData: {
              mimeType: 'image/png',
              data: imageBase64,
            },
          });
        }

        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0,
              responseMimeType: prompt.includes('JSON') ? 'application/json' : undefined,
            },
          }),
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text.trim();
        }
      } catch {
        // Fallback sang tầng tiếp theo
      }
    }

    // 2. Kiểm tra OpenAI API Key
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const messages: any[] = [];
        if (imageBase64) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            ],
          });
        } else {
          messages.push({ role: 'user', content: prompt });
        }

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0,
          }),
        });
        if (resp.ok) {
          const data: any = await resp.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) return text.trim();
        }
      } catch {
        // Fallback sang tầng tiếp theo
      }
    }

    // 3. Sử dụng AGY CLI tích hợp sẵn trên máy
    const agyExe = this.getAgyExePath();
    if (agyExe && !imageBase64) {
      try {
        const proc = spawnSync(agyExe, ['--print', prompt], {
          encoding: 'utf-8',
          timeout: maxWaitMs,
          windowsHide: true,
        });
        if (proc.status === 0 && proc.stdout) {
          return proc.stdout.trim();
        }
      } catch {
        // Fallback
      }
    }

    // 4. Kiểm tra Local Ollama
    try {
      const ollamaResp = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:latest',
          prompt,
          stream: false,
        }),
      });
      if (ollamaResp.ok) {
        const data: any = await ollamaResp.json();
        if (data?.response) return data.response.trim();
      }
    } catch {
      // offline
    }

    return null;
  }

  /**
   * Bước 1 (Actor): LLM phân tích DOM + Screenshot để đề xuất phần tử mục tiêu (Selector / Index / Bounding Box)
   * kèm lý do (Reasoning) và điểm tự tin (Confidence).
   */
  public static async resolveElementWithActor(
    instruction: string,
    actionType: string,
    targetHint: string | undefined,
    candidates: DOMCandidate[],
    screenshotBase64?: string
  ): Promise<ActorProposal | null> {
    if (candidates.length === 0) return null;

    // Rút gọn danh sách ứng viên gửi cho LLM (chỉ lấy thông tin cốt lõi kèm tọa độ Bounding Box)
    const compactCandidates = candidates.slice(0, 35).map((c) => ({
      id: c.candidateId,
      tag: c.tag,
      text: c.text,
      label: c.nearLabel || c.placeholder || c.ariaLabel || c.name,
      context: c.groupContext,
      rect: {
        x: Math.round(c.rect.x),
        y: Math.round(c.rect.y),
        w: Math.round(c.rect.width),
        h: Math.round(c.rect.height),
      },
      disabled: c.disabled,
    }));

    const prompt = `Bạn là Mô hình Đề xuất (Actor Model) trong kiến trúc Actor-Critic Web Automation (Chuẩn IEEE 29119 & Google Test Engineering).
Nhiệm vụ của bạn là phân tích DOM và ảnh chụp màn hình để đề xuất duy nhất 1 phần tử mục tiêu phù hợp nhất cho hành động của người dùng.

Câu lệnh kiểm thử: "${instruction}"
Loại thao tác: ${actionType}
Mục tiêu mong muốn: "${targetHint || ''}"

Danh sách phần tử ứng viên đang hiển thị trên màn hình:
${JSON.stringify(compactCandidates, null, 2)}

Yêu cầu nghiêm ngặt:
1. Đề xuất đúng 1 candidateId phù hợp nhất, kèm điểm tự tin (confidence) từ 0.0 đến 1.0 (ví dụ 0.95), và lý do ngắn gọn.
2. Nếu không có phần tử nào phù hợp trên màn hình, trả về {"candidateId": null, "confidence": 0.0, "reasoning": "Không tìm thấy phần tử phù hợp"}.
3. Trả về đúng 1 định dạng JSON duy nhất, tuyệt đối KHÔNG viết thêm bất kỳ chữ nào khác ngoài JSON:
{
  "candidateId": <số id hoặc null>,
  "confidence": <số thập phân từ 0.0 đến 1.0>,
  "reasoning": "<lý do ngắn gọn đề xuất phần tử này>"
}`;

    const raw = await this.query(prompt, 12000, screenshotBase64);
    if (!raw) return null;

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const conf =
        typeof parsed?.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.85;

      if (typeof parsed?.candidateId === 'number') {
        const exists = candidates.some((c) => c.candidateId === parsed.candidateId);
        if (exists) {
          return {
            candidateId: parsed.candidateId,
            confidence: conf,
            reasoning: parsed.reasoning || parsed.reason || 'Actor đề xuất phần tử',
          };
        }
      } else if (parsed?.candidateId === null) {
        return {
          candidateId: null,
          confidence: 0,
          reasoning: parsed.reasoning || parsed.reason || 'Actor không tìm thấy phần tử',
        };
      }
    } catch {}

    return null;
  }

  /**
   * Bước 2 (Critic): Trước khi Runner click, hệ thống gửi lại vị trí đề xuất cho Critic Model (hoặc Critic Prompt)
   * với câu hỏi: "Dựa trên kịch bản yêu cầu hành động [Action] trên [TargetHint], nút được chọn tại tọa độ này có chính xác là mục tiêu không? Có nguy cơ click nhầm nút đối lập hoặc sai ngữ cảnh không?".
   * Nếu Critic = REJECTED -> Hủy hành động, ghi nhận cảnh báo AMBIGUOUS_TARGET.
   */
  public static async evaluateProposalWithCritic(
    instruction: string,
    actionType: string,
    targetHint: string | undefined,
    candidate: DOMCandidate,
    screenshotBase64?: string
  ): Promise<CriticEvaluation> {
    const label =
      candidate.text ||
      candidate.nearLabel ||
      candidate.placeholder ||
      candidate.ariaLabel ||
      candidate.name ||
      candidate.elemId;

    const prompt = `Bạn là Mô hình Phản biện An toàn (Critic Model) trong kiến trúc Actor-Critic Web Automation.
Trước khi hệ thống thực hiện thao tác click/tương tác vật lý lên trang web, bạn phải kiểm duyệt chéo đề xuất của Actor Model để loại trừ hoàn toàn nguy cơ ảo giác (Hallucination) hoặc click nhầm nút đối lập nguy hiểm.

Câu lệnh kiểm thử: "${instruction}"
Loại thao tác: ${actionType}
Mục tiêu mong muốn: "${targetHint || ''}"

Phần tử được Actor đề xuất:
- Candidate ID: ${candidate.candidateId}
- Thẻ HTML: <${candidate.tag}>
- Văn bản / Nhãn: "${label}"
- Tọa độ Bounding Box: x=${Math.round(candidate.rect.x)}, y=${Math.round(candidate.rect.y)}, w=${Math.round(candidate.rect.width)}, h=${Math.round(candidate.rect.height)}
- Ngữ cảnh vùng: "${candidate.groupContext || ''}"

Câu hỏi thẩm định bắt buộc:
1. Nút/ô được chọn tại tọa độ này có chính xác là mục tiêu "${targetHint || instruction}" không?
2. Có bất kỳ nguy cơ nào bấm nhầm nút mang ngữ nghĩa đối lập nguy hiểm (ví dụ: Sign Out thay vì Sign In, Delete thay vì Save, Cancel thay vì Confirm, Remove thay vì Add), hoặc sai ngữ cảnh không?

Quy tắc phán quyết:
- Trả về "APPROVED" nếu phần tử chính xác là mục tiêu và hoàn toàn an toàn để tương tác.
- Trả về "REJECTED" nếu có nguy cơ bấm nhầm nút đối lập, sai ngữ cảnh, hoặc mục tiêu không khớp.

Trả về duy nhất JSON:
{
  "verdict": "APPROVED" | "REJECTED",
  "confidence": <số thập phân từ 0.0 đến 1.0>,
  "reasoning": "<giải thích lý do phê duyệt hoặc phủ quyết>"
}`;

    const raw = await this.query(prompt, 10000, screenshotBase64);
    if (!raw) {
      return {
        verdict: 'APPROVED',
        confidence: 0.85,
        reasoning: 'Critic offline fallback: không phát hiện nguy cơ rõ rệt',
      };
    }

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const isApproved = String(parsed?.verdict).toUpperCase() === 'APPROVED';
      const conf =
        typeof parsed?.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.9;
      return {
        verdict: isApproved ? 'APPROVED' : 'REJECTED',
        confidence: conf,
        reasoning: parsed?.reasoning || (isApproved ? 'Critic approved proposal' : 'Critic rejected proposal'),
      };
    } catch {}

    return {
      verdict: 'APPROVED',
      confidence: 0.8,
      reasoning: 'Critic fallback parse',
    };
  }

  /**
   * Pipeline Actor-Critic 2 tầng hoàn chỉnh (Trụ cột 6 theo QUY_CHUAN_AI_RESOLVER.md):
   * Bước 1 (Actor): LLM phân tích DOM + Screenshot đề xuất candidate.
   * Bước 2 (Critic): Phản biện đề xuất. Nếu REJECTED -> Hủy hành động (isVetoed = true).
   */
  public static async runActorCriticPipeline(
    instruction: string,
    actionType: string,
    targetHint: string | undefined,
    candidates: DOMCandidate[],
    screenshotBase64?: string
  ): Promise<ActorCriticResult> {
    if (candidates.length === 0) {
      return {
        candidate: null,
        actorProposal: null,
        criticEvaluation: null,
        verdict: 'NO_CANDIDATE',
        reasoning: 'Không có ứng viên nào trên màn hình',
      };
    }

    // Bước 1: Actor Model đề xuất
    const proposal = await this.resolveElementWithActor(
      instruction,
      actionType,
      targetHint,
      candidates,
      screenshotBase64
    );

    if (!proposal || proposal.candidateId === null) {
      return {
        candidate: null,
        actorProposal: proposal,
        criticEvaluation: null,
        verdict: 'NO_CANDIDATE',
        reasoning: proposal?.reasoning || 'Actor không tìm thấy phần tử phù hợp',
      };
    }

    const proposedCandidate = candidates.find((c) => c.candidateId === proposal.candidateId);
    if (!proposedCandidate) {
      return {
        candidate: null,
        actorProposal: proposal,
        criticEvaluation: null,
        verdict: 'NO_CANDIDATE',
        reasoning: `Actor đề xuất candidateId=${proposal.candidateId} không tồn tại trong danh sách`,
      };
    }

    // Bước 2: Critic Model phản biện
    const criticEval = await this.evaluateProposalWithCritic(
      instruction,
      actionType,
      targetHint,
      proposedCandidate,
      screenshotBase64
    );

    if (criticEval.verdict === 'REJECTED') {
      return {
        candidate: null,
        actorProposal: proposal,
        criticEvaluation: criticEval,
        verdict: 'REJECTED',
        isVetoed: true,
        reasoning: `[CRITIC VETO] Đề xuất bị Critic phủ quyết: ${criticEval.reasoning}`,
      };
    }

    return {
      candidate: proposedCandidate,
      actorProposal: proposal,
      criticEvaluation: criticEval,
      verdict: 'APPROVED',
      isVetoed: false,
      reasoning: `${proposal.reasoning} [Critic Approved: ${criticEval.reasoning}]`,
    };
  }

  /**
   * Wrapper tương thích ngược cho resolveElementWithAI, tự động chạy qua Pipeline Actor-Critic
   */
  public static async resolveElementWithAI(
    instruction: string,
    actionType: string,
    targetHint: string | undefined,
    candidates: DOMCandidate[],
    screenshotBase64?: string
  ): Promise<{ candidateId: number; reason: string } | null> {
    const pipelineRes = await this.runActorCriticPipeline(
      instruction,
      actionType,
      targetHint,
      candidates,
      screenshotBase64
    );

    if (pipelineRes.verdict === 'APPROVED' && pipelineRes.candidate) {
      return {
        candidateId: pipelineRes.candidate.candidateId,
        reason: pipelineRes.reasoning,
      };
    }

    return null;
  }

  /**
   * AI Semantic Assertion: Thẩm định xem nội dung/trạng thái hiển thị có thỏa mãn điều kiện kiểm thử hay không
   */
  public static async semanticVerifyWithAI(
    expected: string,
    pageTextSnippet: string,
    screenshotBase64?: string
  ): Promise<{ matched: boolean; reasoning: string }> {
    const prompt = `Bạn là hệ thống Kiểm định Test Oracle thông minh (Semantic Assertion Oracle).
Hãy kiểm tra xem trang web hiện tại có thỏa mãn điều kiện kỳ vọng sau đây hay không:
Kỳ vọng: "${expected}"

Nội dung văn bản hiển thị trên trang:
"""
${pageTextSnippet.slice(0, 1500)}
"""

Hãy xem xét cả yếu tố ngữ nghĩa, từ đồng nghĩa hoặc ngôn ngữ tương đương (ví dụ: "Đặt hàng thành công" tương đương "Thank you for your order" hoặc "Đơn hàng đã được tạo").
Trả về duy nhất JSON hợp lệ:
{"matched": true/false, "reasoning": "<giải thích ngắn gọn trong 1 câu>"}`;

    const raw = await this.query(prompt, 10000, screenshotBase64);
    if (!raw) return { matched: false, reasoning: 'AI query timeout' };

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.matched === 'boolean') {
        return {
          matched: parsed.matched,
          reasoning: parsed.reasoning || (parsed.matched ? 'AI xác nhận khớp ngữ nghĩa' : 'AI xác nhận không khớp'),
        };
      }
    } catch {}

    return { matched: false, reasoning: 'Không thể phân tích phản hồi AI' };
  }

  /**
   * AI Forensic Autopsy: Chẩn đoán nguyên nhân gốc khi một bước kiểm thử bị FAILED
   */
  public static async diagnoseFailureWithAI(
    stepInstruction: string,
    errorReason: string,
    pageContext: string,
    screenshotBase64?: string
  ): Promise<{ rootCause: string; recommendation: string; verdictCategory: string }> {
    const prompt = `Bạn là Kỹ sư Pháp y Kiểm thử (Test Forensic Investigator).
Một bước kiểm thử tự động vừa bị FAILED. Hãy phân tích hiện trường và chẩn đoán nguyên nhân gốc rễ.
Bước kiểm thử: "${stepInstruction}"
Lỗi kỹ thuật: "${errorReason}"
Ngữ cảnh trang web hiện tại:
"""
${pageContext.slice(0, 1200)}
"""

Hãy phân loại chính xác lỗi vào 1 trong 3 nhóm:
- PRODUCT_DEFECT: Lỗi do phần mềm web (sai dữ liệu, lỗi 500, lỗi validation backend, nút bị khóa sai nghiệp vụ).
- TEST_DEFECT: Lỗi do kịch bản test (tìm sai từ khóa, web đổi giao diện, phần tử bị che).
- INFRA_DEFECT: Lỗi mạng, gateway timeout, crash.

Trả về duy nhất định dạng JSON:
{
  "verdictCategory": "PRODUCT_DEFECT" | "TEST_DEFECT" | "INFRA_DEFECT",
  "rootCause": "<nguyên nhân gốc rễ chi tiết trong 1-2 câu>",
  "recommendation": "<hướng dẫn khắc phục cho Developer hoặc QA>"
}`;

    const raw = await this.query(prompt, 12000, screenshotBase64);
    if (!raw) {
      return {
        verdictCategory: 'TEST_DEFECT',
        rootCause: errorReason,
        recommendation: 'Kiểm tra lại giao diện thực tế và kịch bản kiểm thử.',
      };
    }

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        verdictCategory: parsed.verdictCategory || 'TEST_DEFECT',
        rootCause: parsed.rootCause || errorReason,
        recommendation: parsed.recommendation || 'Kiểm tra lại cấu hình kịch bản.',
      };
    } catch {}

    return {
      verdictCategory: 'TEST_DEFECT',
      rootCause: errorReason,
      recommendation: 'Kiểm tra lại giao diện thực tế.',
    };
  }

  /**
   * Nhờ LLM biên dịch kịch bản tiếng Việt tự do phức tạp thành danh sách AtomicAction cứng.
   */
  public static async compileFreeformScenarioWithAI(
    scenarioText: string
  ): Promise<AtomicAction[] | null> {
    const prompt = `Phân tích kịch bản kiểm thử web bằng tiếng Việt tự nhiên sau đây và chuẩn hóa thành danh sách hành động kiểm thử nguyên tử (Atomic Actions).
Kịch bản gốc:
"""
${scenarioText}
"""

Quy tắc phân loại loại hành động (type):
- FILL: Điền văn bản vào ô nhập. Phải có "targetHint" (tên trường/ô) và "value" (dữ liệu điền).
- CLICK: Bấm nút, chọn màu sắc, mở tab, bấm link. Phải có "targetHint".
- SEARCH: Tìm kiếm từ khóa. Phải có "value" (từ khóa) và targetHint="tìm kiếm".
- SELECT_ITEM: Chọn sản phẩm/video/kết quả thứ N. Phải có "itemIndex" (1, 2, ...).
- ASSERT_TEXT: Kiểm tra sự xuất hiện của nội dung chữ/thông báo. Phải có "expectedText".

Quy tắc gộp bước: Nếu một bước có nhiều hành động liên tiếp (ví dụ: "Điền SĐT X, địa chỉ Y rồi bấm Đặt hàng"), hãy tách thành nhiều hành động con nhưng tất cả cùng mang chung một "stepNumber" của bước gốc.

Trả về duy nhất JSON hợp lệ là một mảng AtomicAction:
[
  {
    "stepNumber": 1,
    "subIndex": 1,
    "totalSubActions": 1,
    "rawStepText": "...",
    "subInstruction": "...",
    "type": "FILL" | "CLICK" | "SEARCH" | "SELECT_ITEM" | "ASSERT_TEXT",
    "targetHint": "...",
    "value": "...",
    "expectedText": "...",
    "itemIndex": 1
  }
]
Tuyệt đối KHÔNG viết markdown hay giải thích gì thêm, chỉ trả về chuỗi JSON bắt đầu bằng [ và kết thúc bằng ].`;

    const raw = await this.query(prompt, 10000);
    if (!raw) return null;

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as AtomicAction[];
      }
    } catch {
      // parse error
    }

    return null;
  }

  /**
   * Prompt 14 (Set-of-Marks Visual Indexing - Dual-Stream Multimodal Vision):
   * Gửi ảnh đã gắn nhãn số [1], [2], [3]... lên Gemini Multimodal API (hoặc provider tùy chỉnh)
   * kèm câu hỏi chuẩn và chỉ nhận duy nhất numeric Mark ID hợp lệ để map ngược về Bounding Box gốc
   * -> Triệt tiêu 100% ảo giác đoán mò tọa độ pixel.
   */
  public static async askGeminiVisionSoM(
    imageBase64: string,
    action: string,
    targetHint: string,
    markCount: number,
    options: AskGeminiVisionSoMOptions = {}
  ): Promise<VisionSoMResult> {
    const t0 = performance.now();
    const prompt = buildVisionSoMPrompt(action, targetHint, markCount);

    const validMarkIds =
      options.validMarkIds && options.validMarkIds.length > 0
        ? Array.from(new Set(options.validMarkIds.filter((n) => Number.isInteger(n) && n > 0)))
        : Array.from({ length: Math.max(0, markCount) }, (_, idx) => idx + 1);
    const validIdSet = new Set<number>(validMarkIds);

    const elapsed = () => Math.round((performance.now() - t0) * 1000) / 1000;

    if (!imageBase64 || validMarkIds.length === 0) {
      return {
        id: null,
        reason: 'Thiếu ảnh SoM hoặc danh sách nhãn hợp lệ rỗng',
        apiCalled: false,
        valid: false,
        provider: 'none',
        prompt,
        latencyMs: elapsed(),
      };
    }

    // 1. Ưu tiên Pluggable Multimodal Provider (options.provider hoặc static provider) cho test offline / custom backend
    const activeProvider = options.provider ?? this.customVisionSoMProvider;
    if (activeProvider) {
      try {
        const providerRaw = await activeProvider({
          imageBase64,
          action,
          targetHint,
          markCount: validMarkIds.length,
          prompt,
          validMarkIds,
        });
        const validated = parseAndValidateSoMMarkId(providerRaw, validIdSet, validMarkIds.length);
        const providerName =
          providerRaw && typeof providerRaw === 'object' && providerRaw.provider
            ? providerRaw.provider
            : 'custom-provider';
        return {
          id: validated.id,
          reason: validated.reason,
          apiCalled: true,
          valid: validated.valid,
          rejectedHallucination: validated.rejectedHallucination,
          rawReturnedId: validated.rawReturnedId,
          provider: providerName,
          prompt,
          latencyMs: elapsed(),
        };
      } catch (err: any) {
        return {
          id: null,
          reason: `Lỗi Multimodal Vision SoM provider: ${err?.message || String(err)}`,
          apiCalled: true,
          valid: false,
          rejectedHallucination: false,
          provider: 'custom-provider',
          prompt,
          latencyMs: elapsed(),
        };
      }
    }

    // 2. Gọi Gemini Multimodal REST API trực tiếp với inlineData image/png
    const geminiKey = options.apiKey !== undefined ? options.apiKey : process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return {
        id: null,
        reason: 'Chưa cấu hình GEMINI_API_KEY và không có Vision SoM provider (graceful offline fallback)',
        apiCalled: false,
        valid: false,
        rejectedHallucination: false,
        provider: 'none',
        prompt,
        latencyMs: elapsed(),
      };
    }

    const geminiModel =
      options.model ||
      process.env.GEMINI_VISION_MODEL ||
      process.env.GEMINI_MODEL ||
      'gemini-flash-lite-latest';
    const timeoutMs = options.timeoutMs ?? 15000;
    const fetchImpl = options.fetchFn || fetch;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!resp.ok) {
        return {
          id: null,
          reason: `Gemini Multimodal API trả về HTTP ${resp.status}`,
          apiCalled: true,
          valid: false,
          rejectedHallucination: false,
          provider: 'gemini-multimodal',
          prompt,
          latencyMs: elapsed(),
        };
      }

      const data: any = await resp.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      const validated = parseAndValidateSoMMarkId(rawText, validIdSet, validMarkIds.length);
      return {
        id: validated.id,
        reason: validated.reason,
        apiCalled: true,
        valid: validated.valid,
        rejectedHallucination: validated.rejectedHallucination,
        rawReturnedId: validated.rawReturnedId,
        provider: 'gemini-multimodal',
        prompt,
        latencyMs: elapsed(),
      };
    } catch (err: any) {
      return {
        id: null,
        reason: `Lỗi gọi Gemini Multimodal API: ${err?.message || String(err)}`,
        apiCalled: true,
        valid: false,
        rejectedHallucination: false,
        provider: 'gemini-multimodal',
        prompt,
        latencyMs: elapsed(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Hàm tiện ích xuất trực tiếp để gọi Gemini Multimodal Vision SoM (ủy quyền qua LLMBridge.askGeminiVisionSoM).
 */
export async function askGeminiVisionSoM(
  imageBase64: string,
  action: string,
  targetHint: string,
  markCount: number,
  options?: AskGeminiVisionSoMOptions
): Promise<VisionSoMResult> {
  return LLMBridge.askGeminiVisionSoM(imageBase64, action, targetHint, markCount, options);
}
