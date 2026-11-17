import { AtomicAction } from './types';
import { LLMBridge } from './llm-bridge';

export interface ParsedScenario {
  totalSteps: number;
  rawSteps: { stepNumber: number; text: string }[];
  atomicActions: AtomicAction[];
}

/**
 * BỘ BIÊN DỊCH KỊCH BẢN TIẾNG VIỆT TỰ NHIÊN (ENTERPRISE PRODUCTION EDITION)
 * Chuyển đổi ngôn ngữ tự nhiên tiếng Việt thành danh sách AtomicAction chuẩn hóa:
 * - Hỗ trợ các hành động thực tế: FILL, CLICK, HOVER, SEARCH, SELECT_ITEM, SCROLL, PRESS_KEY, WAIT,
 *   ASSERT_TEXT, ASSERT_URL, NAVIGATE_BACK, RELOAD, SWITCH_TAB.
 * - Tự động bóc tách bước gộp ("rồi", "sau đó", dấu phẩy) và kế thừa động từ.
 * - Trích xuất chính xác tham số trong dấu ngoặc kép ("..."), nháy đơn ('...'), hoặc backtick (`...`).
 */
export function compileVietnameseScenario(scenarioText: string): ParsedScenario {
  const rawSegments = splitIntoRawSteps(scenarioText);
  const rawSteps: { stepNumber: number; text: string }[] = [];
  const atomicActions: AtomicAction[] = [];

  rawSegments.forEach((seg, idx) => {
    const cleaned = seg
      .replace(/^\s*(?:\(\d+\)|bước\s*\d+\s*[:.-]?|\d+\s*[.):-])\s*/i, '')
      .trim()
      .replace(/\.\s*$/, '');

    if (!cleaned) return;

    const numMatch = seg.match(/^\s*(?:\((\d+)\)|bước\s*(\d+)|(\d+)\s*[.):-])/i);
    const stepNumber = numMatch
      ? parseInt(numMatch[1] || numMatch[2] || numMatch[3], 10)
      : idx + 1;

    rawSteps.push({ stepNumber, text: cleaned });

    const subClauses = splitCompoundStep(cleaned);
    subClauses.forEach((clause, subIdx) => {
      const parsed = parseSingleClause(clause, stepNumber, subIdx + 1, subClauses.length, cleaned);
      atomicActions.push(parsed);
    });
  });

  return {
    totalSteps: rawSteps.length,
    rawSteps,
    atomicActions,
  };
}

/**
 * Biên dịch nâng cao kết hợp AI khi người dùng cung cấp kịch bản dạng văn bản tự do không đánh số.
 */
export async function compileVietnameseScenarioAsync(scenarioText: string): Promise<ParsedScenario> {
  const fastResult = compileVietnameseScenario(scenarioText);
  if (fastResult.atomicActions.length > 0) {
    return fastResult;
  }

  // Nếu kịch bản không theo khuôn mẫu đánh số -> nhờ AI Compiler
  const aiActions = await LLMBridge.compileFreeformScenarioWithAI(scenarioText);
  if (aiActions && aiActions.length > 0) {
    const rawStepsMap = new Map<number, string>();
    for (const act of aiActions) {
      if (!rawStepsMap.has(act.stepNumber)) {
        rawStepsMap.set(act.stepNumber, act.rawStepText || act.subInstruction);
      }
    }
    const rawSteps = Array.from(rawStepsMap.entries()).map(([stepNumber, text]) => ({
      stepNumber,
      text,
    }));
    return {
      totalSteps: rawSteps.length,
      rawSteps,
      atomicActions: aiActions,
    };
  }

  return fastResult;
}

function splitIntoRawSteps(text: string): string[] {
  if (text.includes('->')) {
    return text
      .split(/\s*->\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitCompoundStep(stepText: string): string[] {
  if (/^(kiểm\s+tra|xác\s+nhận|đảm\s+bảo|verify|assert)\b/i.test(stepText)) {
    return [stepText];
  }

  const placeholders: string[] = [];
  const masked = stepText.replace(/(`[^`]+`|"[^"]+"|'[^']+')(?![\w])/g, (match) => {
    placeholders.push(match);
    return `__TOKEN_${placeholders.length - 1}__`;
  });

  const rawParts = masked
    .split(/\s+(?:rồi|sau\s+đó|tiếp\s+theo)\s+|,\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const restoredParts = rawParts.map((part) =>
    part.replace(/__TOKEN_(\d+)__/g, (_, idx) => placeholders[Number(idx)])
  );

  let lastVerb = '';
  return restoredParts.map((part) => {
    const verbMatch = part.match(
      /^(điền|nhập|gõ|bấm|nhấn|click|chọn|mở|tìm\s+kiếm|kiểm\s+tra|rê\s+chuột|hover|cuộn|kéo|chờ|đợi)\b/i
    );
    if (verbMatch) {
      lastVerb = verbMatch[1];
      return part;
    }
    if (lastVerb && /^(điền|nhập|gõ)$/i.test(lastVerb)) {
      return `${lastVerb} ${part}`;
    }
    return part;
  });
}

function extractQuotedOrBacktick(str: string): { value: string; remainder: string } | null {
  const m = str.match(/`([^`]+)`|"([^"]+)"|'([^']+)'/);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3];
  const remainder = str.replace(m[0], '').trim();
  return { value, remainder };
}

function parseSingleClause(
  clause: string,
  stepNumber: number,
  subIndex: number,
  totalSubActions: number,
  rawStepText: string
): AtomicAction {
  const text = clause.trim();

  // 1. CHỜ / ĐỢI (WAIT)
  const waitMatch = text.match(/^(?:chờ|đợi)\s+(\d+(?:\.\d+)?)\s*(giây|s|phút|ms)?/i);
  if (waitMatch) {
    const amount = parseFloat(waitMatch[1]);
    const unit = (waitMatch[2] || 'giây').toLowerCase();
    let waitMs = amount * 1000;
    if (unit === 'ms') waitMs = amount;
    if (unit === 'phút') waitMs = amount * 60000;

    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'WAIT',
      waitMs: Math.round(waitMs),
    };
  }

  // 2. CUỘN / KÉO TRANG (SCROLL)
  if (/^(?:cuộn|kéo|scroll)\b/i.test(text)) {
    let scrollDirection: 'DOWN' | 'UP' | 'BOTTOM' | 'TOP' = 'DOWN';
    let scrollAmount = 600;

    if (/(?:cuối\s+trang|xuống\s+đáy|đáy\s+trang)/i.test(text)) {
      scrollDirection = 'BOTTOM';
      scrollAmount = 10000;
    } else if (/(?:đầu\s+trang|lên\s+đầu|trên\s+cùng)/i.test(text)) {
      scrollDirection = 'TOP';
      scrollAmount = 10000;
    } else if (/(?:lên|ngược\s+lên)/i.test(text)) {
      scrollDirection = 'UP';
      const numMatch = text.match(/(\d+)\s*(?:px)?/i);
      if (numMatch) scrollAmount = parseInt(numMatch[1], 10);
    } else {
      scrollDirection = 'DOWN';
      const numMatch = text.match(/(\d+)\s*(?:px)?/i);
      if (numMatch) scrollAmount = parseInt(numMatch[1], 10);
    }

    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'SCROLL',
      scrollDirection,
      scrollAmount,
    };
  }

  // 3. NHẤN PHÍM BÀN PHÍM (PRESS_KEY)
  const keyMatch =
    text.match(/^(?:nhấn|bấm|gõ)\s+phím\s+([a-zA-Z0-9_\-]+|enter|esc|escape|tab|space)/i) ||
    text.match(/^(?:nhấn|bấm)\s+(enter|esc|escape|tab|space)\b/i);
  if (keyMatch) {
    let keyName = keyMatch[1];
    const kLower = keyName.toLowerCase();
    if (kLower === 'esc' || kLower === 'escape') keyName = 'Escape';
    else if (kLower === 'enter') keyName = 'Enter';
    else if (kLower === 'tab') keyName = 'Tab';
    else if (kLower === 'space') keyName = 'Space';

    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'PRESS_KEY',
      keyName,
    };
  }

  // 4. QUAY LẠI / TẢI LẠI TRANG (NAVIGATE_BACK / RELOAD)
  if (/^(?:quay\s+lại\s+trang\s+trước|back\s+lại\s+trang\s+trước|back\s+lại|trở\s+về\s+trang\s+trước)$/i.test(text)) {
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'NAVIGATE_BACK',
    };
  }
  if (/^(?:tải\s+lại\s+trang|f5|reload\s+trang|làm\s+mới\s+trang)$/i.test(text)) {
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'RELOAD',
    };
  }

  // 5. CHUYỂN TAB / ĐÓNG TAB (SWITCH_TAB)
  if (/^(?:chuyển\s+(?:sang\s+)?tab\s+mới|chuyển\s+tab|đóng\s+tab\s+hiện\s+tại|đóng\s+tab)\b/i.test(text)) {
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'SWITCH_TAB',
    };
  }

  // 5.1. XỬ LÝ HỘP THOẠI POPUP GỐC (HANDLE_DIALOG)
  if (
    /^(?:chấp\s+nhận|xác\s+nhận|đồng\s+ý|ok)\s+(?:hộp\s+thoại|popup|dialog|alert|thông\s+báo)/i.test(text) ||
    /^(?:chấp\s+nhận\s+hộp\s+thoại|xác\s+nhận\s+hộp\s+thoại|đồng\s+ý\s+hộp\s+thoại|accept\s+dialog)/i.test(text)
  ) {
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'HANDLE_DIALOG',
      dialogAction: 'ACCEPT',
    };
  }
  if (
    /^(?:hủy|đóng|từ\s+chối|bỏ\s+qua|dismiss|cancel)\s+(?:hộp\s+thoại|popup|dialog|alert|thông\s+báo)/i.test(text) ||
    /^(?:hủy\s+hộp\s+thoại|đóng\s+hộp\s+thoại|từ\s+chối\s+hộp\s+thoại|dismiss\s+dialog)/i.test(text)
  ) {
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'HANDLE_DIALOG',
      dialogAction: 'DISMISS',
    };
  }

  // 6. KIỂM TRA URL (ASSERT_URL)
  if (/(?:url|đường\s+dẫn|link)\s+(?:chứa|có|là|bao\s+gồm)/i.test(text)) {
    const quoted = extractQuotedOrBacktick(text);
    const expectedUrlPart = quoted
      ? quoted.value
      : text.replace(/^.*?(?:chứa|có|là|bao\s+gồm)\s*/i, '').trim();

    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'ASSERT_URL',
      expectedUrlPart,
    };
  }

  // 7. KIỂM TRA HIỂN THỊ NỘI DUNG (ASSERT_TEXT)
  if (/^(?:kiểm\s+tra|xác\s+nhận|đảm\s+bảo|thấy)\b/i.test(text)) {
    const quoted = extractQuotedOrBacktick(text);
    const expectedText = quoted
      ? quoted.value
      : text
          .replace(
            /^(?:kiểm\s+tra|xác\s+nhận|đảm\s+bảo)\s*(?:hiện|hiển\s+thị|có)?\s*(?:chữ|thông\s+báo|nội\s+dung|text|nút|button)?\s*/i,
            ''
          )
          .trim();

    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'ASSERT_TEXT',
      expectedText,
    };
  }

  // 8. TÌM KIẾM (SEARCH)
  if (/^(?:tìm\s+kiếm|tìm|search)\b/i.test(text)) {
    const quoted = extractQuotedOrBacktick(text);
    const value = quoted
      ? quoted.value
      : text.replace(/^(?:tìm\s+kiếm|tìm|search)\s*(?:từ\s+khóa|sản\s+phẩm|tin\s+tức)?\s*/i, '').trim();

    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'SEARCH',
      targetHint: 'tìm kiếm',
      value,
    };
  }

  // 9. CHỌN SẢN PHẨM / VIDEO / TIN TỨC / KẾT QUẢ THEO THỨ TỰ (SELECT_ITEM)
  if (
    /^(?:chọn|bấm\s+vào|bấm|click\s+vào|click|mở)\s+(?:vào\s+)?(?:sản\s+phẩm|mặt\s+hàng|kết\s+quả|video|tin\s+tức|bài\s+viết|tin|bài|item|bài\s+hát)\s+(?:đầu\s+tiên|thứ\s+\d+|số\s+\d+)/i.test(
      text
    )
  ) {
    const numMatch = text.match(/(?:thứ|số)\s+(\d+)/i);
    const itemIndex = numMatch ? parseInt(numMatch[1], 10) : 1;
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'SELECT_ITEM',
      targetHint: 'tin tức',
      itemIndex,
    };
  }

  // 10. RÊ CHUỘT (HOVER)
  if (/^(?:rê\s+chuột|hover|di\s+chuột)\b/i.test(text)) {
    const quoted = extractQuotedOrBacktick(text);
    const withoutVerb = text.replace(/^(?:rê\s+chuột|hover|di\s+chuột)\s*(?:vào|lên)?\s*/i, '').trim();
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'HOVER',
      targetHint: quoted ? quoted.value : withoutVerb,
    };
  }

  // 11. ĐIỀN / NHẬP DỮ LIỆU (FILL)
  if (/^(?:điền|nhập|gõ|fill)\b/i.test(text)) {
    const withoutVerb = text.replace(/^(?:điền|nhập|gõ|fill)\s*(?:vào\s+ô|ô|trường)?\s*/i, '').trim();
    const allMatches = Array.from(withoutVerb.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'/g));

    if (allMatches.length >= 2) {
      const firstVal = allMatches[0][1] ?? allMatches[0][2] ?? allMatches[0][3] ?? '';
      const secondVal = allMatches[1][1] ?? allMatches[1][2] ?? allMatches[1][3] ?? '';
      const between = withoutVerb.slice(allMatches[0].index! + allMatches[0][0].length, allMatches[1].index!).trim();

      let targetHint = '';
      let value = '';

      if (/(?:vào\s+ô|vào\s+trường|vào|cho)\b/i.test(between)) {
        // Cú pháp chuẩn DSL: Điền "[giá_trị]" vào ô "[tên_ô]"
        value = firstVal;
        targetHint = secondVal;
      } else if (/(?:là|giá\s+trị|:)\s*$/i.test(between)) {
        // Cú pháp: Điền "[tên_ô]" là "[giá_trị]"
        targetHint = firstVal;
        value = secondVal;
      } else {
        const lastMatch = allMatches[allMatches.length - 1];
        value = lastMatch[1] ?? lastMatch[2] ?? lastMatch[3] ?? '';
        const beforeLast = withoutVerb.slice(0, lastMatch.index).trim();
        targetHint = beforeLast
          .replace(/[`"']/g, '')
          .replace(/\b(là|với\s+giá\s+trị|giá\s+trị|:)\s*$/i, '')
          .trim();
      }

      return {
        stepNumber,
        subIndex,
        totalSubActions,
        rawStepText,
        subInstruction: text,
        type: 'FILL',
        targetHint: targetHint || 'input',
        value,
      };
    }

    const quoted = extractQuotedOrBacktick(withoutVerb);
    if (quoted) {
      const targetHint = quoted.remainder
        .replace(/[`"']/g, '')
        .replace(/\b(là|với\s+giá\s+trị|giá\s+trị|:)\s*$/i, '')
        .trim();
      return {
        stepNumber,
        subIndex,
        totalSubActions,
        rawStepText,
        subInstruction: text,
        type: 'FILL',
        targetHint: targetHint || 'input',
        value: quoted.value,
      };
    } else {
      const laSplit = withoutVerb.split(/\s+là\s+/i);
      if (laSplit.length === 2) {
        return {
          stepNumber,
          subIndex,
          totalSubActions,
          rawStepText,
          subInstruction: text,
          type: 'FILL',
          targetHint: laSplit[0].trim(),
          value: laSplit[1].trim(),
        };
      }
      const tokens = withoutVerb.split(/\s+/);
      const value = tokens.pop() || '';
      const targetHint = tokens.join(' ') || 'input';
      return {
        stepNumber,
        subIndex,
        totalSubActions,
        rawStepText,
        subInstruction: text,
        type: 'FILL',
        targetHint,
        value,
      };
    }
  }

  // 12. CHỌN THUỘC TÍNH / BẤM NÚT / MỞ (CLICK)
  const quoted = extractQuotedOrBacktick(text);
  const withoutVerb = text
    .replace(/^(?:bấm|nhấn|click|chọn|mở|vào)\s*(?:nút|button|link|mục|tab|ô|biểu\s+tượng|icon)?\s*/i, '')
    .trim();

  if (quoted) {
    const contextHint = withoutVerb
      .replace(/`[^`]+`|"[^"]+"|'[^']+'/, '')
      .trim();
    return {
      stepNumber,
      subIndex,
      totalSubActions,
      rawStepText,
      subInstruction: text,
      type: 'CLICK',
      targetHint: quoted.value,
      contextHint: contextHint || undefined,
    };
  }

  return {
    stepNumber,
    subIndex,
    totalSubActions,
    rawStepText,
    subInstruction: text,
    type: 'CLICK',
    targetHint: withoutVerb || text,
  };
}
