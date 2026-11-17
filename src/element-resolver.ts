import * as fs from 'fs';
import * as path from 'path';
import { AtomicAction, DOMCandidate, ElementFingerprint } from './types';
import { LLMBridge } from './llm-bridge';

const TRACE_CACHE_FILE = path.join(process.cwd(), 'output', 'trace_dataset.json');

export const ANTYNOM_VIOLATION = 'ANTYNOM_VIOLATION';
export const ANTONYM_VIOLATION = 'ANTYNOM_VIOLATION'; // Alias cho tính tương thích

export type MatchSource = 'CACHE' | 'SEMANTIC_RULE' | 'FUZZY_HEALED' | 'LLM' | 'NONE';

export interface ResolveCandidateResult {
  candidate: DOMCandidate | null;
  matchSource: MatchSource;
  reasoning?: string;
  flag?: 'ANTYNOM_VIOLATION' | 'ANTONYM_VIOLATION' | 'AMBIGUOUS_TARGET' | string;
  damerauDistance?: number;
  similarity?: number;
  confidence?: number;
  deltaMargin?: number;
  criticVerdict?: 'APPROVED' | 'REJECTED';
}

export interface SafetyMarginResult {
  top1Score: number;
  top2Score: number;
  top1Norm: number;
  top2Norm: number;
  deltaMargin: number;
  isAmbiguous: boolean;
}

/**
 * TRỤ CỘT 3: SAFETY MARGIN CHECK (Delta Margin >= 20%)
 * Tính toán Delta = (Top1_Score - Top2_Score) / 100.
 * Nếu Delta < 0.20 (20%) hoặc Top1_Score < 0.85 (85%):
 * Hệ thống đánh dấu trạng thái "AMBIGUOUS" (isAmbiguous = true)
 * và kích hoạt quy trình đa thể thức Actor-Critic Multimodal Resolution.
 */
export function computeSafetyMargin(top1Score: number, top2Score: number = 0): SafetyMarginResult {
  const top1Norm = Math.min(Math.max(top1Score / 100, 0), 1.0);
  const top2Norm = Math.min(Math.max(top2Score / 100, 0), 1.0);
  const rawDelta = (top1Score - top2Score) / 100;
  const deltaMargin = Math.round(Math.max(0, rawDelta) * 1000) / 1000;
  const isAmbiguous = deltaMargin < 0.20 || top1Norm < 0.85;
  return {
    top1Score,
    top2Score,
    top1Norm,
    top2Norm,
    deltaMargin,
    isAmbiguous,
  };
}

export interface TraceRecord {
  domain: string;
  stepInstruction: string;
  actionType: string;
  targetHint?: string;
  fingerprint: ElementFingerprint;
  updatedAt: string;
}

export interface DamerauResult {
  distance: number;
  similarity: number;
  maxLen: number;
  isAcceptable: boolean;
}

export interface AntonymBarrierPair {
  category: string;
  groupA: string[];
  groupB: string[];
}

/**
 * Bảng ma trận các cặp từ đối lập nghiêm ngặt (Trụ cột 5 - Antonym Barrier Matrix)
 * Bất kể điểm Levenshtein hay Embedding cao đến đâu, nếu Target Text và Candidate
 * thuộc hai cực đối lập của ma trận thì lập tức bị loại bỏ (Score = 0) và gắn cờ vi phạm ANTYNOM_VIOLATION.
 */
export const ANTONYM_BARRIER_MATRIX: AntonymBarrierPair[] = [
  // 1. Authentication / Session
  {
    category: 'AUTH_SESSION',
    groupA: ['sign in', 'login', 'log in', 'signin', 'đăng nhập', 'dang nhap'],
    groupB: ['sign out', 'logout', 'log out', 'signout', 'đăng xuất', 'dang xuat', 'thoát', 'thoat'],
  },
  // 2. Persistence / Deletion
  {
    category: 'PERSISTENCE',
    groupA: ['save', 'lưu', 'luu', 'keep', 'giữ', 'giu'],
    groupB: ['delete', 'xóa', 'xoa', 'del', 'destroy', 'hủy dữ liệu'],
  },
  // 3. Collection Modification (Add / Remove)
  {
    category: 'COLLECTION_MUTATION',
    groupA: ['add', 'thêm', 'them', 'insert', 'chèn', 'create', 'tạo mới', 'tao moi'],
    groupB: ['remove', 'gỡ', 'go', 'gỡ bỏ', 'go bo', 'loại bỏ', 'loai bo', 'unlink'],
  },
  // 4. Confirmation / Cancellation
  {
    category: 'CONFIRMATION',
    groupA: ['confirm', 'xác nhận', 'xac nhan', 'apply', 'áp dụng', 'ap dung', 'submit', 'hoàn tất', 'hoan tat'],
    groupB: ['cancel', 'hủy', 'huy', 'hủy bỏ', 'huy bo', 'abort', 'dismiss', 'bỏ qua', 'bo qua'],
  },
  // 5. Acceptance / Rejection
  {
    category: 'ACCEPTANCE',
    groupA: ['accept', 'chấp nhận', 'chap nhan', 'approve', 'duyệt', 'duyet'],
    groupB: ['reject', 'từ chối', 'tu choi', 'deny', 'bác bỏ', 'bac bo'],
  },
  // 6. State Toggle (Enable / Disable)
  {
    category: 'STATE_TOGGLE',
    groupA: ['enable', 'bật', 'bat', 'kích hoạt', 'kich hoat', 'turn on', 'activate'],
    groupB: ['disable', 'tắt', 'tat', 'vô hiệu hóa', 'vo hieu hoa', 'turn off', 'deactivate'],
  },
  // 7. Agreement (Agree / Decline)
  {
    category: 'AGREEMENT',
    groupA: ['agree', 'đồng ý', 'dong y', 'consent'],
    groupB: ['decline', 'từ chối', 'tu choi', 'disagree', 'không đồng ý', 'khong dong y'],
  },
  // 8. Boolean Choice (Yes / No)
  {
    category: 'BOOLEAN_CHOICE',
    groupA: ['yes', 'có', 'co', 'true'],
    groupB: ['no', 'không', 'khong', 'false'],
  },
];

/**
 * Bảng từ điển mở rộng ban đầu (có thể tự động bổ sung liên tục qua cơ chế AI Self-Healing)
 */
const BASE_SEMANTIC_MAP: Record<string, string[]> = {
  'tài khoản': ['tài khoản', 'ten dang nhap', 'username', 'user-name', 'user_name', 'email', 'login', 'account', 'khách hàng', 'user'],
  'mật khẩu': ['mật khẩu', 'mat khau', 'password', 'pass', 'pwd', 'mật mã'],
  'đăng nhập': ['đăng nhập', 'dang nhap', 'login', 'log in', 'sign in', 'signin', 'login-button', 'xác thực'],
  'tìm kiếm': ['tìm kiếm', 'tim kiem', 'search', 'search_query', 'tìm sản phẩm', 'nhập từ khóa', 'keyword', 'q'],
  'thêm vào giỏ': ['thêm vào giỏ', 'them vao gio', 'thêm giỏ hàng', 'add to cart', 'add-to-cart', 'buy-now-cart', 'cho vào giỏ'],
  'quay lại': ['quay lại', 'trở lại', 'back', 'back to products', 'back-to-products', 'return', 'trở về'],
  'giỏ hàng': ['giỏ hàng', 'gio hang', 'cart', 'shopping_cart_link', 'shopping-cart', 'view-cart', 'giỏ'],
  'mua hàng': ['mua hàng', 'mua ngay', 'thanh toán', 'checkout', 'check out', 'tiến hành đặt hàng', 'tiếp tục thanh toán'],
  'sđt': ['sđt', 'số điện thoại', 'so dien thoai', 'điện thoại', 'phone', 'mobile', 'tel', 'last-name', 'lastname'],
  'họ tên': ['họ tên', 'họ và tên', 'tên người nhận', 'first-name', 'firstname', 'fullname', 'tên'],
  'địa chỉ': ['địa chỉ', 'dia chi', 'address', 'street', 'nhận hàng', 'postal-code', 'postalcode', 'zip'],
  'tiếp tục': ['tiếp tục', 'continue', 'next', 'bước tiếp', 'kế tiếp'],
  'đặt hàng': ['đặt hàng', 'dat hang', 'hoàn tất đặt hàng', 'xác nhận đặt hàng', 'place order', 'submit order', 'finish', 'thanh toán đơn'],
};

/**
 * Loại bỏ dấu tiếng Việt để so khớp không dấu và có dấu song song
 */
export function removeVietnameseDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeClean(str: string | undefined): string {
  if (!str) return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function getTokens(str: string): string[] {
  return normalizeClean(str)
    .split(/[^a-z0-9à-ỹ]/i)
    .filter((t) => t.length >= 2);
}

function expandKeywords(hint: string | undefined): string[] {
  const h = normalizeClean(hint);
  if (!h) return [];
  const expanded = new Set<string>([h, removeVietnameseDiacritics(h)]);

  for (const [key, list] of Object.entries(BASE_SEMANTIC_MAP)) {
    if (h.includes(key) || list.some((syn) => h === syn)) {
      list.forEach((syn) => {
        expanded.add(syn);
        expanded.add(removeVietnameseDiacritics(syn));
      });
    }
  }
  return Array.from(expanded);
}

/**
 * Tính điểm trùng lặp token theo chỉ số Jaccard (Matches / Union)
 * Chống bẫy: Tránh việc các chuỗi cha (VD: "Chưa đăng nhập") đạt điểm ngang bằng với mục tiêu chính xác ("Đăng nhập").
 */
function computeTokenOverlapScore(targetText: string, candidateText: string): number {
  const tTokens = getTokens(targetText);
  const cTokens = getTokens(candidateText);
  if (tTokens.length === 0 || cTokens.length === 0) return 0;

  const union = new Set([...tTokens, ...cTokens]);
  let matches = 0;
  for (const tt of tTokens) {
    if (cTokens.includes(tt)) matches++;
  }
  return Math.round((matches / union.size) * 100);
}

/**
 * TRỤ CỘT 4: THUẬT TOÁN DAMERAU-LEVENSHTEIN DISTANCE
 * Hỗ trợ 4 phép biến đổi cơ bản:
 * 1. Deletion (Xóa)
 * 2. Insertion (Chèn)
 * 3. Substitution (Thay thế)
 * 4. Adjacent Transposition (Hoán vị 2 ký tự liền kề như "ni" <-> "in", "te" <-> "et")
 */
export function damerauLevenshteinDistance(source: string, target: string): number {
  const s1 = source;
  const s2 = target;
  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;

      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // Deletion
        d[i][j - 1] + 1,       // Insertion
        d[i - 1][j - 1] + cost // Substitution
      );

      // Hoán vị 2 ký tự liền kề (Transposition)
      if (
        i > 1 &&
        j > 1 &&
        s1[i - 1] === s2[j - 2] &&
        s1[i - 2] === s2[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[m][n];
}

/**
 * Tính toán khoảng cách chuẩn hóa:
 * Sim = 1 - (distance / max(len(s1), len(s2)))
 * Cho phép tự phục hồi (Self-Healing) khi Sim >= 0.75 (hoặc distance <= 2 với từ ngắn có maxLen >= 5 và <= 8).
 */
export function computeDamerauSimilarity(s1: string, s2: string): DamerauResult {
  const norm1 = normalizeClean(s1);
  const norm2 = normalizeClean(s2);

  if (!norm1 && !norm2) {
    return { distance: 0, similarity: 1, maxLen: 0, isAcceptable: true };
  }
  if (!norm1 || !norm2) {
    const maxLen = Math.max(norm1.length, norm2.length);
    return { distance: maxLen, similarity: 0, maxLen, isAcceptable: false };
  }
  if (norm1 === norm2) {
    return { distance: 0, similarity: 1, maxLen: norm1.length, isAcceptable: true };
  }

  // 1. So khớp chuỗi có dấu
  const distRaw = damerauLevenshteinDistance(norm1, norm2);
  const maxLenRaw = Math.max(norm1.length, norm2.length);
  const simRaw = Math.max(0, 1 - distRaw / maxLenRaw);

  // 2. So khớp chuỗi không dấu
  const noAcc1 = removeVietnameseDiacritics(norm1);
  const noAcc2 = removeVietnameseDiacritics(norm2);
  const distNoAcc = damerauLevenshteinDistance(noAcc1, noAcc2);
  const maxLenNoAcc = Math.max(noAcc1.length, noAcc2.length);
  const simNoAcc = Math.max(0, 1 - distNoAcc / maxLenNoAcc);

  const bestDist = simNoAcc > simRaw ? distNoAcc : distRaw;
  const bestSim = Math.max(simRaw, simNoAcc);
  const bestMaxLen = simNoAcc > simRaw ? maxLenNoAcc : maxLenRaw;

  // Cho phép tự phục hồi (Self-Healing) khi:
  // - Sim >= 0.75 (chuẩn Big Tech)
  // - Hoặc distance <= 2 với từ ngắn (độ dài từ 5 đến 8 ký tự, tránh bắt nhầm từ siêu ngắn <= 3 ký tự)
  const isAcceptable = bestSim >= 0.75 || (bestDist <= 2 && bestMaxLen >= 5 && bestMaxLen <= 8);

  return {
    distance: bestDist,
    similarity: Math.round(bestSim * 1000) / 1000,
    maxLen: bestMaxLen,
    isAcceptable,
  };
}

/**
 * So khớp Damerau-Levenshtein mở rộng:
 * Hỗ trợ so sánh cả toàn bộ chuỗi lẫn từng từ / cửa sổ trượt n-grams của Candidate
 */
export function matchFuzzyCandidateText(target: string, candidateText: string): DamerauResult {
  const fullRes = computeDamerauSimilarity(target, candidateText);
  if (fullRes.isAcceptable) return fullRes;

  const tTokens = getTokens(target);
  const cTokens = getTokens(candidateText);

  if (tTokens.length === 1 && cTokens.length > 1) {
    let best = fullRes;
    for (const token of cTokens) {
      const res = computeDamerauSimilarity(target, token);
      if (res.similarity > best.similarity) {
        best = res;
      }
    }
    return best;
  } else if (tTokens.length > 1 && cTokens.length >= tTokens.length) {
    const n = tTokens.length;
    let best = fullRes;
    for (let i = 0; i <= cTokens.length - n; i++) {
      const windowStr = cTokens.slice(i, i + n).join(' ');
      const res = computeDamerauSimilarity(target, windowStr);
      if (res.similarity > best.similarity) {
        best = res;
      }
    }
    return best;
  }

  return fullRes;
}

/**
 * Kiểm tra xem một chuỗi có thuộc về nhóm từ khóa chỉ định hay không
 */
function textMatchesGroup(
  text: string,
  group: string[],
  allowFuzzy: boolean = true
): { matches: boolean; matchedKeyword?: string; distance?: number } {
  const norm = normalizeClean(text);
  if (!norm) return { matches: false };
  const normNoAcc = removeVietnameseDiacritics(norm);

  // 1. So khớp chính xác hoặc nguyên cụm từ (Word boundary)
  for (const kw of group) {
    const kwNorm = normalizeClean(kw);
    const kwNoAcc = removeVietnameseDiacritics(kwNorm);

    if (norm === kwNorm || normNoAcc === kwNoAcc) {
      return { matches: true, matchedKeyword: kw, distance: 0 };
    }

    const regex = new RegExp(`(^|[^a-z0-9à-ỹ])${kwNorm}([^a-z0-9à-ỹ]|$)`, 'i');
    const regexNoAcc = new RegExp(`(^|[^a-z0-9])${kwNoAcc}([^a-z0-9]|$)`, 'i');
    if (regex.test(norm) || regexNoAcc.test(normNoAcc)) {
      return { matches: true, matchedKeyword: kw, distance: 0 };
    }
  }

  // 2. So khớp mờ bằng Damerau-Levenshtein (nếu cho phép)
  if (allowFuzzy) {
    for (const kw of group) {
      const fuzzyRes = matchFuzzyCandidateText(norm, kw);
      if (fuzzyRes.isAcceptable) {
        return { matches: true, matchedKeyword: kw, distance: fuzzyRes.distance };
      }
    }
  }

  return { matches: false };
}

export interface AntonymCheckResult {
  hasConflict: boolean;
  violationCode?: 'ANTYNOM_VIOLATION' | 'ANTONYM_VIOLATION';
  category?: string;
  targetPole?: 'groupA' | 'groupB';
  targetKeyword?: string;
  candidateKeyword?: string;
  reason?: string;
}

/**
 * TRỤ CỘT 5: HÀNG RÀO TỪ TRÁI NGHĨA (ANTONYM BARRIER)
 * Đối soát Target Text và Candidate qua Antonym Barrier Matrix:
 * Nếu Target Text và Candidate thuộc hai cực đối lập của cùng một danh mục thì lập tức
 * bị loại bỏ (Score = 0) và gắn cờ vi phạm ANTYNOM_VIOLATION.
 */
export function checkAntonymConflict(
  targetText: string,
  candidateOrText: DOMCandidate | string
): AntonymCheckResult {
  if (!targetText) return { hasConflict: false };

  const candidateTexts: string[] = [];
  if (typeof candidateOrText === 'string') {
    candidateTexts.push(candidateOrText);
  } else {
    if (candidateOrText.text) candidateTexts.push(candidateOrText.text);
    if (candidateOrText.ariaLabel) candidateTexts.push(candidateOrText.ariaLabel);
    if (candidateOrText.value) candidateTexts.push(candidateOrText.value);
    if (candidateOrText.nearLabel) candidateTexts.push(candidateOrText.nearLabel);
    if (candidateOrText.name) candidateTexts.push(candidateOrText.name);
    if (candidateOrText.elemId) candidateTexts.push(candidateOrText.elemId);
  }

  for (const pair of ANTONYM_BARRIER_MATRIX) {
    // Kiểm tra target thuộc cực A hay cực B (có hỗ trợ fuzzy nhận diện typo ở target)
    const targetInA = textMatchesGroup(targetText, pair.groupA, true);
    const targetInB = textMatchesGroup(targetText, pair.groupB, true);

    if (!targetInA.matches && !targetInB.matches) continue;

    // Phân định cực của target: nếu khớp cả 2, ưu tiên bên có khoảng cách nhỏ hơn (chính xác hơn)
    let targetPole: 'groupA' | 'groupB' | null = null;
    let targetKw: string | undefined;

    if (targetInA.matches && targetInB.matches) {
      const distA = targetInA.distance ?? 999;
      const distB = targetInB.distance ?? 999;
      if (distA < distB) {
        targetPole = 'groupA';
        targetKw = targetInA.matchedKeyword;
      } else if (distB < distA) {
        targetPole = 'groupB';
        targetKw = targetInB.matchedKeyword;
      } else {
        continue;
      }
    } else if (targetInA.matches) {
      targetPole = 'groupA';
      targetKw = targetInA.matchedKeyword;
    } else if (targetInB.matches) {
      targetPole = 'groupB';
      targetKw = targetInB.matchedKeyword;
    } else {
      continue;
    }

    const oppositeGroup = targetPole === 'groupA' ? pair.groupB : pair.groupA;
    const sameGroup = targetPole === 'groupA' ? pair.groupA : pair.groupB;

    for (const candStr of candidateTexts) {
      // 1. Nếu candidate cùng cực với target -> Hợp lệ, an toàn
      const candInSame = textMatchesGroup(candStr, sameGroup, false);
      if (candInSame.matches) continue;

      // 2. Nếu candidate rơi vào cực đối lập -> VI PHẠM NGHIÊM NGẶT (ANTYNOM_VIOLATION)
      const candInOpposite = textMatchesGroup(candStr, oppositeGroup, false);
      if (candInOpposite.matches) {
        const candKw = candInOpposite.matchedKeyword;
        return {
          hasConflict: true,
          violationCode: 'ANTYNOM_VIOLATION',
          category: pair.category,
          targetPole,
          targetKeyword: targetKw,
          candidateKeyword: candKw,
          reason: `[ANTYNOM_VIOLATION] Xung đột từ trái nghĩa (${pair.category}): Target "${targetText}" (${targetKw}) đối lập với ứng viên "${candStr}" (${candKw}).`,
        };
      }
    }
  }

  return { hasConflict: false };
}

/**
 * STRICT & AI-ASSISTED ELEMENT RESOLVER (ENTERPRISE EDITION)
 * 1. Kiểm tra Cache vân tay (0ms).
 * 2. Antonym Barrier: Chặn đứng mọi phần tử đối lập (Score = 0).
 * 3. Chấm điểm hình học + Ngữ nghĩa song ngữ + Damerau-Levenshtein Fuzzy Intent.
 * 4. Nếu điểm tin cậy cao (>= 75) -> Chấp nhận ngay với cờ tự phục hồi (Self-Healing).
 * 5. Nếu điểm thấp -> Tự động gọi LLM Bridge với Actor-Critic Guardrail bảo vệ.
 * 6. Tự động lưu vân tay vào Dataset.
 */
export async function resolveTargetCandidate(
  url: string,
  action: AtomicAction,
  candidates: DOMCandidate[],
  screenshotBase64?: string
): Promise<ResolveCandidateResult> {
  // 1. Trường hợp SELECT_ITEM ("Chọn sản phẩm / video / kết quả đầu tiên / thứ N")
  if (action.type === 'SELECT_ITEM') {
    const targetIdx = action.itemIndex || 1;
    const cardCandidates = candidates.filter(
      (c) => c.isCardItem && c.cardIndex === targetIdx
    );
    if (cardCandidates.length > 0) {
      const preferred =
        cardCandidates.find(
          (c) =>
            c.elemId === 'video-title' ||
            c.elemId === 'video-title-link' ||
            /title|name|header|heading|headline/i.test(c.fingerprint.stableClasses.join(' '))
        ) ||
        cardCandidates.find((c) => c.tag === 'a' && c.text.length > 10) ||
        cardCandidates.find((c) => c.tag === 'a' && c.text.length > 3) ||
        cardCandidates[0];
      saveTraceRecord(url, action, preferred.fingerprint);
      return { candidate: preferred, matchSource: 'SEMANTIC_RULE' };
    }

    const contentLinks = candidates.filter((c) => {
      if (c.tag !== 'a' && c.role !== 'link') return false;
      if (!c.text || c.text.trim().length < 12) return false;
      if (c.rect.y < 80) return false;
      if (/đăng nhập|đăng ký|liên hệ|điều khoản|chính sách|hà nội|thời tiết|quảng cáo/i.test(c.text)) return false;
      return true;
    });

    if (contentLinks.length > 0) {
      contentLinks.sort((a, b) => a.rect.y - b.rect.y);
      const chosen = contentLinks[targetIdx - 1] || contentLinks[0];
      saveTraceRecord(url, action, chosen.fingerprint);
      return { candidate: chosen, matchSource: 'SEMANTIC_RULE' };
    }

    return { candidate: null, matchSource: 'NONE' };
  }

  // 2. Lọc ứng viên tương thích theo ActionType
  const compatibleCandidates = candidates.filter((c) => {
    if (action.type === 'FILL' || action.type === 'SEARCH') {
      const isTextInput =
        c.tag === 'textarea' ||
        (c.tag === 'input' &&
          !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden'].includes(c.type || '')) ||
        c.role === 'textbox' ||
        c.role === 'searchbox' ||
        c.role === 'combobox';
      return isTextInput;
    }
    if (action.type === 'CLICK' || action.type === 'HOVER') {
      if (
        c.tag === 'input' &&
        !['submit', 'button', 'radio', 'checkbox'].includes(c.type || '')
      ) {
        return false;
      }
      return true;
    }
    return true;
  });

  if (compatibleCandidates.length === 0) {
    return { candidate: null, matchSource: 'NONE' };
  }

  // 3. Fast-Path Heuristic Scoring & Fuzzy Intent Self-Healing
  const keywords = expandKeywords(action.targetHint);
  const contextKeywords = expandKeywords(action.contextHint);
  const targetRaw = normalizeClean(action.targetHint || action.subInstruction || '');
  const targetNoAccent = removeVietnameseDiacritics(targetRaw);

  interface ScoredCandidate {
    candidate: DOMCandidate;
    score: number;
    damerauDist?: number;
    damerauSim?: number;
    isFuzzyHealed: boolean;
    hasAntonymViolation: boolean;
    antonymReason?: string;
  }

  const scoredCandidates: ScoredCandidate[] = [];
  let hasAntonymViolation = false;
  let antonymViolationDetail: string | undefined;

  for (const cand of compatibleCandidates) {
    // TRỤ CỘT 5: ANTYNOM BARRIER CHECK
    // Bất kể điểm Levenshtein hay Embedding cao đến đâu, nếu Target Text và Candidate
    // thuộc hai cực đối lập của ma trận thì lập tức bị loại bỏ (Score = 0) và gắn cờ vi phạm ANTYNOM_VIOLATION.
    const antonymCheck = checkAntonymConflict(targetRaw || action.subInstruction, cand);
    if (antonymCheck.hasConflict) {
      hasAntonymViolation = true;
      antonymViolationDetail = antonymCheck.reason;
      (cand as any).antonymViolation = true;
      (cand as any).antonymReason = antonymCheck.reason;
      scoredCandidates.push({
        candidate: cand,
        score: 0,
        isFuzzyHealed: false,
        hasAntonymViolation: true,
        antonymReason: antonymCheck.reason,
      });
      continue; // Bỏ qua ứng viên này, điểm tuyệt đối = 0
    }

    let score = 0;
    let candDamerauDist: number | undefined;
    let candDamerauSim: number | undefined;
    let candIsFuzzy = false;

    const textNorm = normalizeClean(cand.text);
    const textNoAccent = removeVietnameseDiacritics(textNorm);
    const placeholderNorm = normalizeClean(cand.placeholder);
    const nearLabelNorm = normalizeClean(cand.nearLabel);
    const nameNorm = normalizeClean(cand.name);
    const idNorm = normalizeClean(cand.elemId);
    const hrefNorm = normalizeClean(cand.href);
    const ariaNorm = normalizeClean(cand.ariaLabel);
    const groupNorm = normalizeClean(cand.groupContext);
    const classNorm = normalizeClean(cand.fingerprint?.stableClasses?.join(' ') || '');
    const valueNorm = normalizeClean(cand.value);

    // 3.1. So khớp từ khóa chính xác & từ điển ngữ nghĩa
    for (const kw of keywords) {
      if (textNorm === kw || valueNorm === kw || textNoAccent === kw) score = Math.max(score, 100);
      if (placeholderNorm === kw || nearLabelNorm === kw || ariaNorm === kw) score = Math.max(score, 95);
      if (nameNorm === kw || idNorm === kw) score = Math.max(score, 90);
      if (hrefNorm === kw || hrefNorm === `/${kw}`) score = Math.max(score, 88);

      if (textNorm && textNorm.includes(kw)) score = Math.max(score, 82);
      if (nearLabelNorm && nearLabelNorm.includes(kw)) score = Math.max(score, 85);
      if (placeholderNorm && placeholderNorm.includes(kw)) score = Math.max(score, 85);
      if (ariaNorm && ariaNorm.includes(kw)) score = Math.max(score, 80);
      if (nameNorm && nameNorm.includes(kw)) score = Math.max(score, 78);
      if (idNorm && idNorm.includes(kw)) score = Math.max(score, 78);
      if (hrefNorm && hrefNorm.includes(kw)) score = Math.max(score, 75);
      if (classNorm && classNorm.includes(kw)) score = Math.max(score, 70);
    }

    // 3.2. TRỤ CỘT 4: Damerau-Levenshtein Distance & Fuzzy Intent Self-Healing
    // Chỉ kích hoạt khi target và candidate có sự sai khác ký tự (typo/transposition: distance >= 1)
    if (targetRaw.length >= 2) {
      const candFields = [
        { text: textNorm, weight: 1.0 },
        { text: ariaNorm, weight: 0.95 },
        { text: placeholderNorm, weight: 0.95 },
        { text: nearLabelNorm, weight: 0.95 },
        { text: valueNorm, weight: 0.95 },
        { text: nameNorm, weight: 0.90 },
        { text: idNorm, weight: 0.88 },
      ].filter((f) => !!f.text);

      for (const field of candFields) {
        const directRes = computeDamerauSimilarity(targetRaw, field.text);
        let bestFuzzy = directRes;

        if (!bestFuzzy.isAcceptable && field.text.includes(' ')) {
          const subRes = matchFuzzyCandidateText(targetRaw, field.text);
          if (subRes.isAcceptable) {
            bestFuzzy = subRes;
          }
        }

        // CHỈ xét tự phục hồi lỗi chính tả khi có sai khác ký tự thực tế (distance >= 1)
        if (bestFuzzy.isAcceptable && bestFuzzy.distance >= 1) {
          let fuzzyScore = Math.round(bestFuzzy.similarity * 100 * field.weight);
          if (bestFuzzy.distance === 1 && fuzzyScore < 85) {
            fuzzyScore = 85;
          }
          if (fuzzyScore > score) {
            score = fuzzyScore;
            candDamerauDist = bestFuzzy.distance;
            candDamerauSim = bestFuzzy.similarity;
            candIsFuzzy = true;
          }
        }
      }
    }

    // 3.3. Token Overlap cho câu lệnh tự do không có trong từ điển
    if (targetRaw.length >= 3) {
      const overlapText = computeTokenOverlapScore(targetRaw, textNorm);
      const overlapLabel = computeTokenOverlapScore(targetRaw, nearLabelNorm || placeholderNorm);
      score = Math.max(score, overlapText, overlapLabel);
    }

    // 3.4. Điểm thưởng ngữ cảnh nhóm
    if (score > 0 && contextKeywords.length > 0 && groupNorm) {
      if (contextKeywords.some((ck) => groupNorm.includes(ck))) {
        score += 15;
      }
    }

    // 3.5. Điểm thưởng / phạt theo tính chất phần tử tương tác
    if (action.type === 'CLICK' || action.type === 'HOVER') {
      if (cand.tag === 'button' || cand.type === 'submit' || cand.role === 'button' || cand.tag === 'option') {
        score += 15;
      } else if (cand.tag === 'a' || cand.role === 'link') {
        score += 8;
      } else if (/^h[1-6]$/i.test(cand.tag)) {
        // Phạt các thẻ tiêu đề (heading) khi thực hiện hành động CLICK
        score -= 25;
      } else if (cand.tag === 'div' || cand.tag === 'span' || cand.tag === 'p') {
        if (/^(chưa|đã|không|thông báo|trạng thái)\b/i.test(textNorm)) {
          score -= 35;
        }
      }
    }

    score = Math.max(0, score);

    scoredCandidates.push({
      candidate: cand,
      score,
      damerauDist: candDamerauDist,
      damerauSim: candDamerauSim,
      isFuzzyHealed: candIsFuzzy,
      hasAntonymViolation: false,
    });
  }

  // Nếu toàn bộ ứng viên tương thích trên trang đều bị chặn bởi Antonym Barrier, dừng ngay lập tức (Fail-Fast)
  const allViolated =
    compatibleCandidates.length > 0 &&
    compatibleCandidates.every((c) => (c as any).antonymViolation);

  if (allViolated) {
    return {
      candidate: null,
      matchSource: 'NONE',
      flag: 'ANTYNOM_VIOLATION',
      reasoning:
        antonymViolationDetail ||
        '[ANTYNOM_VIOLATION] Toàn bộ ứng viên trên màn hình đều đối lập với mục tiêu.',
    };
  }

  // Lọc danh sách ứng viên hợp lệ (không vi phạm từ trái nghĩa) và sắp xếp điểm từ cao xuống thấp
  const validCandidates = scoredCandidates
    .filter((sc) => !sc.hasAntonymViolation)
    .sort((a, b) => b.score - a.score);

  if (validCandidates.length === 0) {
    return {
      candidate: null,
      matchSource: 'NONE',
      flag: hasAntonymViolation ? 'ANTYNOM_VIOLATION' : undefined,
      reasoning: hasAntonymViolation ? antonymViolationDetail : undefined,
    };
  }

  const top1 = validCandidates[0];
  const top2 = validCandidates[1] || null;

  const top1Score = top1 ? top1.score : 0;
  const top2Score = top2 ? top2.score : 0;

  // TRỤ CỘT 3: TÍNH TOÁN SAFETY MARGIN (DELTA MARGIN >= 20%)
  const marginResult = computeSafetyMargin(top1Score, top2Score);

  // 3.6. Fast-Path Chấp nhận tức thì (0ms) khi ĐỘC TÔN VÀ AN TOÀN
  // Điều kiện: Điểm Top 1 >= 85% VÀ Delta Margin >= 20% (isAmbiguous = false)
  if (!marginResult.isAmbiguous && top1 && top1.score >= 85) {
    saveTraceRecord(url, action, top1.candidate.fingerprint);
    return {
      candidate: top1.candidate,
      matchSource: top1.isFuzzyHealed ? 'FUZZY_HEALED' : 'SEMANTIC_RULE',
      reasoning: top1.isFuzzyHealed
        ? `Tự phục hồi lỗi chính tả qua Damerau-Levenshtein (Khoảng cách = ${top1.damerauDist}, Độ tương đồng = ${top1.damerauSim}, Delta Margin = ${(marginResult.deltaMargin * 100).toFixed(1)}%, Mục tiêu "${action.targetHint}" -> "${top1.candidate.text || top1.candidate.nearLabel || top1.candidate.placeholder || top1.candidate.name}")`
        : `Xác định chính xác phần tử mục tiêu (Điểm = ${top1.score}, Delta Margin = ${(marginResult.deltaMargin * 100).toFixed(1)}% >= 20%)`,
      damerauDistance: top1.damerauDist,
      similarity: top1.damerauSim,
      confidence: marginResult.top1Norm,
      deltaMargin: marginResult.deltaMargin,
      criticVerdict: 'APPROVED',
    };
  }

  // 4. TRỤ CỘT 6: KÍCH HOẠT QUY TRÌNH ĐA THỂ THỨC ACTOR-CRITIC PIPELINE
  // Kích hoạt khi trạng thái AMBIGUOUS (Delta Margin < 20% hoặc Top 1 < 85%)
  const eligibleCandidates = validCandidates.map((vc) => vc.candidate);
  const actorCriticRes = await LLMBridge.runActorCriticPipeline(
    action.subInstruction,
    action.type,
    action.targetHint,
    eligibleCandidates,
    screenshotBase64
  );

  if (actorCriticRes) {
    // Bước 2 (Critic): Phản biện kiểm tra đề xuất
    // Nếu Critic = REJECTED -> HỦY HÀNH ĐỘNG, GHI NHẬN CẢNH BÁO AMBIGUOUS_TARGET
    if (actorCriticRes.verdict === 'REJECTED' || actorCriticRes.isVetoed) {
      return {
        candidate: null,
        matchSource: 'NONE',
        flag: 'AMBIGUOUS_TARGET',
        reasoning: actorCriticRes.reasoning || '[CRITIC VETO] Hành động bị Critic Model phủ quyết vì nguy cơ bấm nhầm nút hoặc sai ngữ cảnh.',
        criticVerdict: 'REJECTED',
        deltaMargin: marginResult.deltaMargin,
        confidence: actorCriticRes.criticEvaluation?.confidence,
      };
    }

    if (actorCriticRes.verdict === 'APPROVED' && actorCriticRes.candidate) {
      // VÒNG KHÓA BẢO VỆ 2: Antonym check đối soát lại lần nữa với đề xuất của Actor
      const antonymCheck = checkAntonymConflict(
        action.targetHint || action.subInstruction,
        actorCriticRes.candidate
      );
      if (antonymCheck.hasConflict) {
        return {
          candidate: null,
          matchSource: 'NONE',
          flag: 'ANTYNOM_VIOLATION',
          reasoning: `[CRITIC VETO] Phủ quyết đề xuất của Actor do vi phạm Hàng rào từ trái nghĩa: ${antonymCheck.reason}`,
          criticVerdict: 'REJECTED',
          deltaMargin: marginResult.deltaMargin,
        };
      }

      saveTraceRecord(url, action, actorCriticRes.candidate.fingerprint);
      return {
        candidate: actorCriticRes.candidate,
        matchSource: 'LLM',
        reasoning: actorCriticRes.reasoning,
        criticVerdict: 'APPROVED',
        confidence: actorCriticRes.actorProposal?.confidence ?? marginResult.top1Norm,
        deltaMargin: marginResult.deltaMargin,
      };
    }
  }

  // 5. Ambiguous Tie Check: Nếu điểm ngang nhau (Delta = 0) và không có LLM phân định -> Thất bại an toàn
  if (top1 && top2 && top1Score === top2Score && marginResult.deltaMargin === 0) {
    return {
      candidate: null,
      matchSource: 'NONE',
      flag: 'AMBIGUOUS_TARGET',
      reasoning: `[AMBIGUOUS_TARGET] Phát hiện ${validCandidates.length} ứng viên có độ tương đồng ngang nhau (Top 1 = ${top1Score}, Top 2 = ${top2Score}, Delta = 0%) nhưng không có AI giải quyết.`,
      deltaMargin: marginResult.deltaMargin,
      confidence: marginResult.top1Norm,
    };
  }

  // 6. Fallback điểm chấp nhận được (>= 70) khi LLM offline và không phải hòa điểm tuyệt đối
  if (top1 && top1.score >= 70) {
    saveTraceRecord(url, action, top1.candidate.fingerprint);
    return {
      candidate: top1.candidate,
      matchSource: top1.isFuzzyHealed ? 'FUZZY_HEALED' : 'SEMANTIC_RULE',
      reasoning: top1.isFuzzyHealed
        ? `Tự phục hồi lỗi chính tả qua Damerau-Levenshtein (Khoảng cách = ${top1.damerauDist}, Delta Margin = ${(marginResult.deltaMargin * 100).toFixed(1)}%, Mục tiêu "${action.targetHint}")`
        : `Chấp nhận ứng viên fallback điểm cao (Điểm = ${top1.score}, Delta Margin = ${(marginResult.deltaMargin * 100).toFixed(1)}%)`,
      damerauDistance: top1.damerauDist,
      similarity: top1.damerauSim,
      confidence: marginResult.top1Norm,
      deltaMargin: marginResult.deltaMargin,
    };
  }

  // 7. Không tìm thấy ứng viên hợp lệ
  return {
    candidate: null,
    matchSource: 'NONE',
    flag: hasAntonymViolation ? 'ANTYNOM_VIOLATION' : undefined,
    reasoning: hasAntonymViolation ? antonymViolationDetail : undefined,
    deltaMargin: marginResult.deltaMargin,
  };
}

function saveTraceRecord(
  url: string,
  action: AtomicAction,
  fingerprint: ElementFingerprint
): void {
  try {
    const dir = path.dirname(TRACE_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let records: TraceRecord[] = [];
    if (fs.existsSync(TRACE_CACHE_FILE)) {
      records = JSON.parse(fs.readFileSync(TRACE_CACHE_FILE, 'utf-8'));
    }

    let domain = 'local';
    try {
      domain = new URL(url).host;
    } catch {
      // ignore
    }

    const existingIdx = records.findIndex(
      (r) => r.domain === domain && r.stepInstruction === action.subInstruction
    );

    const record: TraceRecord = {
      domain,
      stepInstruction: action.subInstruction,
      actionType: action.type,
      targetHint: action.targetHint,
      fingerprint,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      records[existingIdx] = record;
    } else {
      records.push(record);
    }

    fs.writeFileSync(TRACE_CACHE_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch {
    // Không làm gián đoạn luồng test
  }
}
