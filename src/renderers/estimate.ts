// Draws the output of `costcatch estimate` for one model or several, as tables, plain text or JSON.
import chalk from "chalk";
import type { EstimateResult, TokenEstimate } from "../core/token-estimator.js";
import { formatCost } from "../core/cost-calculator.js";
import {
  palette,
  glyph,
  c,
  cb,
  dim,
  faint,
  truncate,
  BAR_CH,
  renderBar,
  termWidth,
  truncateAnsi,
  boxed,
} from "../ui/theme.js";

const BOX = {
  tl: "┌", t: "─", tr: "┐", tj: "┬",
  ml: "├", m: "─", mr: "┤", mj: "┼",
  bl: "└", b: "─", br: "┘", bj: "┴",
  v: "│",
} as const;



// Widths are measured from plain, because the color codes in styled would count as columns.
interface CellData {
  plain: string;
  styled: string;
  align: "left" | "right";
}

function mkCell(plain: string, styled: string, align: "left" | "right" = "left"): CellData {
  return { plain, styled, align };
}

function renderTable(
  headers: CellData[],
  rows: CellData[][],
  opts: { indent?: number; headerColor?: string; borderColor?: string; maxWidth?: number } = {},
): string {
  const indent = opts.indent ?? 2;
  const borderColor = opts.borderColor ?? palette.faint;
  const bFn = chalk.hex(borderColor);
  const pad = " ".repeat(indent);

  const colCount = headers.length;

  const widths = new Array<number>(colCount).fill(0);
  for (let i = 0; i < colCount; i++) {
    widths[i] = Math.max(widths[i], headers[i].plain.length);
  }
  for (const row of rows) {
    for (let i = 0; i < Math.min(row.length, colCount); i++) {
      widths[i] = Math.max(widths[i], row[i].plain.length);
    }
  }

  // Shrink the widest column until the table fits inside the frame borders and indent, or the frame cuts it off.
  const budget = (opts.maxWidth ?? termWidth()) - 4 - indent;
  const tableWidth = () => widths.reduce((sum, w) => sum + w + 3, 1);
  while (tableWidth() > budget) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 6) break;
    widths[widest] -= 1;
  }
  const clip = (cell: CellData, w: number): CellData =>
    cell.plain.length <= w
      ? cell
      : { ...cell, plain: truncate(cell.plain, w), styled: truncateAnsi(cell.styled, w) };
  headers = headers.map((h, i) => clip(h, widths[i]));
  rows = rows.map((r) => r.map((cell, i) => clip(cell, widths[i] ?? cell.plain.length)));

  const topBorder = pad + bFn(BOX.tl) +
    widths.map((w) => bFn(BOX.t.repeat(w + 2))).join(bFn(BOX.tj)) +
    bFn(BOX.tr);

  const midBorder = pad + bFn(BOX.ml) +
    widths.map((w) => bFn(BOX.m.repeat(w + 2))).join(bFn(BOX.mj)) +
    bFn(BOX.mr);

  const botBorder = pad + bFn(BOX.bl) +
    widths.map((w) => bFn(BOX.b.repeat(w + 2))).join(bFn(BOX.bj)) +
    bFn(BOX.br);

  function renderRow(cells: CellData[]): string {
    const parts = cells.map((cell, i) => {
      const w = widths[i];
      const plainLen = cell.plain.length;
      const padNeeded = Math.max(0, w - plainLen);
      if (cell.align === "right") {
        return " " + " ".repeat(padNeeded) + cell.styled + " ";
      }
      return " " + cell.styled + " ".repeat(padNeeded) + " ";
    });
    return pad + bFn(BOX.v) + parts.join(bFn(BOX.v)) + bFn(BOX.v);
  }

  const lines: string[] = [];
  lines.push(topBorder);
  lines.push(renderRow(headers));
  lines.push(midBorder);
  for (const row of rows) {
    lines.push(renderRow(row));
  }
  lines.push(botBorder);

  return lines.join("\n");
}

function renderGradientBar(fraction: number, width: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  const filledCells = Math.round(f * width);
  const emptyCells = width - filledCells;

  const filledBar = chalk.hex(palette.text)(BAR_CH.full.repeat(filledCells));
  const emptyBar = chalk.hex(palette.faint)(BAR_CH.light.repeat(emptyCells));
  return filledBar + emptyBar;
}

function marginText(est: TokenEstimate): string {
  return est.marginTokens !== undefined ? `±${est.marginTokens} tok` : `±${Math.round(est.margin * 100)}%`;
}

const CONTENT_LABELS: Record<TokenEstimate["contentBucket"], string> = {
  prose: "prose",
  code: "code",
  data: "data",
  dense: "dense text",
  uncommon: "uncommon words",
  cjk: "CJK",
  script: "non-Latin script",
  repetitive: "repeated characters",
};

function contentText(est: TokenEstimate): { label: string; family: string } {
  const label = est.marginTokens !== undefined ? "short text" : CONTENT_LABELS[est.contentBucket];
  return { label, family: est.measured ? est.tokenizerFamily : `${est.tokenizerFamily}, not measured for this model` };
}

const FOOTER = `estimated from text features ${glyph.dot} margins measured on real tokenizers`;

function confidenceBadge(est: TokenEstimate): { plain: string; styled: string } {
  const pct = marginText(est);
  switch (est.confidence) {
    case "high":
      return { plain: `${glyph.ok} ${pct}`, styled: c("ok", `${glyph.ok} ${pct}`) };
    case "medium":
      return { plain: `${glyph.warn} ${pct}`, styled: c("warn", `${glyph.warn} ${pct}`) };
    case "low":
      return { plain: `${glyph.warn} ${pct}`, styled: c("err", `${glyph.warn} ${pct}`) };
  }
}

function sectionHeader(text: string): string {
  return `  ${c("accent", glyph.bullet)} ${cb("text", text)}`;
}

export function renderSingleEstimate(
  result: EstimateResult,
  fileName: string,
  useColor: boolean = true,
): string {
  if (!useColor) return renderPlainSingle(result, fileName);

  const { estimate, costUsd, sections } = result;
  const lines: string[] = [];

  lines.push(`${dim("File")}     ${chalk.hex(palette.text).bold(fileName)}`);
  lines.push(`${dim("Model")}    ${cb("token", result.model)}`);
  const content = contentText(estimate);
  lines.push(`${dim("Content")}  ${c("accent2", content.label)} ${faint(glyph.dot)} ${dim(content.family)} ${faint(glyph.dot)} ${dim(`~${estimate.charsPerToken.toFixed(1)} chars/tok`)}`);
  lines.push("");

  lines.push(sectionHeader("Token Estimate"));
  lines.push("");

  const badge = confidenceBadge(estimate);
  const tokenTable = renderTable(
    [
      mkCell("Metric", dim("Metric")),
      mkCell("Value", dim("Value"), "right"),
    ],
    [
      [
        mkCell("Characters", dim("Characters")),
        mkCell(estimate.chars.toLocaleString(), c("text", estimate.chars.toLocaleString()), "right"),
      ],
      [
        mkCell("Estimated Tokens", dim("Estimated Tokens")),
        mkCell(`~${estimate.tokens.toLocaleString()}`, c("token", `~${estimate.tokens.toLocaleString()}`), "right"),
      ],
      [
        mkCell("Confidence", dim("Confidence")),
        mkCell(badge.plain, badge.styled, "right"),
      ],
    ],
    { indent: 4 },
  );
  lines.push(tokenTable);
  lines.push("");

  lines.push(sectionHeader("Cost Estimate (input only)"));
  lines.push("");

  if (costUsd !== null) {
    // Use one precision for the whole column, because formatCost picks it per value and
    // would print $0.00825 next to $0.08.
    const volumes: [string, number][] = [
      ["Per single call", costUsd],
      ["10 calls/day (300/mo)", costUsd * 10 * 30],
      ["100 calls/day (3k/mo)", costUsd * 100 * 30],
      ["1,000 calls/day (30k/mo)", costUsd * 1000 * 30],
    ];
    const smallest = Math.min(...volumes.map(([, v]) => v).filter((v) => v > 0));
    const decimals = Number.isFinite(smallest)
      ? Math.min(10, Math.max(2, -Math.floor(Math.log10(smallest)) + 1))
      : 2;
    const money = (v: number): string => `$${v.toFixed(decimals)}`;

    const costTable = renderTable(
      [
        mkCell("Scale", dim("Scale")),
        mkCell("Est. Cost (Monthly)", dim("Est. Cost (Monthly)"), "right"),
      ],
      volumes.map(([label, value]) => [
        mkCell(label, dim(label)),
        mkCell(money(value), c("cost", money(value)), "right"),
      ]),
      { indent: 4 },
    );
    lines.push(costTable);
  } else {
    lines.push(`    ${c("warn", glyph.warn)} ${dim("Pricing unavailable for this model")}`);
  }

  if (sections && sections.length > 0) {
    lines.push("");
    lines.push(sectionHeader("Breakdown"));
    lines.push("");

    const barWidth = 10;

    const breakdownRows = sections.map((sec) => {
      const pct = Math.round(sec.fraction * 100);
      const pctStr = `${pct}%`;
      const tokStr = sec.tokens.toLocaleString();
      const barPlain = BAR_CH.full.repeat(Math.round(sec.fraction * barWidth)).padEnd(barWidth, " ");
      const barStyled = renderBar(sec.fraction, barWidth, palette.accent);

      return [
        mkCell(truncate(sec.label, 30), dim(truncate(sec.label, 30))),
        mkCell(tokStr, c("token", tokStr), "right"),
        mkCell(pctStr, dim(pctStr), "right"),
        mkCell(barPlain, barStyled),
      ];
    });

    const breakdownTable = renderTable(
      [
        mkCell("Section", dim("Section")),
        mkCell("Tokens", dim("Tokens"), "right"),
        mkCell("%", dim("%"), "right"),
        mkCell("Distribution", dim("Distribution")),
      ],
      breakdownRows,
      { indent: 4 },
    );
    lines.push(breakdownTable);
  }

  return boxed({
    rows: lines,
    headerRight: dim(`estimate ${glyph.dot} ${result.model}`),
    footer: faint(`${glyph.spark} ${FOOTER}`),
  });
}

export function renderComparison(
  results: EstimateResult[],
  fileName: string,
  useColor: boolean = true,
): string {
  if (!useColor) return renderPlainComparison(results, fileName);

  const lines: string[] = [];
  const chars = results[0]?.estimate.chars ?? 0;

  lines.push(`${dim("File")}  ${chalk.hex(palette.text).bold(fileName)}  ${faint(glyph.dot)}  ${dim(`${chars.toLocaleString()} chars`)}`);
  lines.push("");

  lines.push(sectionHeader("Model Comparison"));
  lines.push("");

  const sorted = [...results].sort((a, b) => (a.costUsd ?? 0) - (b.costUsd ?? 0));
  const maxCost = Math.max(...results.map((r) => r.costUsd ?? 0), 0.000001);
  const barWidth = 10;

  const compRows = sorted.map((r) => {
    const cleanModel = r.model.includes("/") ? r.model.split("/").pop()! : r.model;
    const modelDisplay = truncate(cleanModel, 20);
    const tokStr = `~${r.estimate.tokens.toLocaleString()}`;
    const costStr = r.costUsd !== null ? formatCost(r.costUsd) : "$?.??";
    const costFraction = (r.costUsd ?? 0) / maxCost;
    const barPlain = BAR_CH.full.repeat(Math.round(costFraction * barWidth)).padEnd(barWidth, " ");
    const barStyled = renderGradientBar(costFraction, barWidth);

    return [
      mkCell(modelDisplay, chalk.hex(palette.text).bold(modelDisplay)),
      mkCell(tokStr, c("token", tokStr), "right"),
      mkCell(costStr, r.costUsd !== null ? c("cost", costStr) : c("warn", costStr), "right"),
      mkCell(barPlain, barStyled),
    ];
  });

  const compTable = renderTable(
    [
      mkCell("Model", dim("Model")),
      mkCell("Tokens", dim("Tokens"), "right"),
      mkCell("Cost", dim("Cost"), "right"),
      mkCell("Impact", dim("Impact")),
    ],
    compRows,
    { indent: 2 },
  );
  lines.push(compTable);

  if (sorted.length >= 2) {
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];
    if (cheapest.costUsd !== null && mostExpensive.costUsd !== null && mostExpensive.costUsd > 0) {
      const savings = Math.round((1 - cheapest.costUsd / mostExpensive.costUsd) * 100);
      if (savings > 5) {
        lines.push("");
        lines.push(`    ${c("ok", glyph.spark)} ${c("ok", truncate(cheapest.model, 22))} is ${c("ok", savings + "% cheaper")} than ${dim(truncate(mostExpensive.model, 22))}`);

        const cheapMonthly = cheapest.costUsd * 100 * 30;
        const expensiveMonthly = mostExpensive.costUsd * 100 * 30;
        const monthlySavings = expensiveMonthly - cheapMonthly;
        if (monthlySavings > 1) {
          lines.push(`      ${dim("Saves")} ${c("cost", formatCost(monthlySavings))}${dim("/mo at 100 calls/day")}`);
        }
      }
    }
  }

  lines.push("");
  lines.push(sectionHeader("Tokenizer Details"));
  lines.push("");

  const detailRows = sorted.map((r) => {
    const badge = confidenceBadge(r.estimate);
    const ratio = `~${r.estimate.charsPerToken.toFixed(1)} ch/tok`;
    return [
      mkCell(truncate(r.model, 26), dim(truncate(r.model, 26))),
      mkCell(r.estimate.tokenizerFamily, dim(r.estimate.tokenizerFamily)),
      mkCell(ratio, dim(ratio), "right"),
      mkCell(badge.plain, badge.styled, "right"),
    ];
  });

  const detailTable = renderTable(
    [
      mkCell("Model", dim("Model")),
      mkCell("Tokenizer", dim("Tokenizer")),
      mkCell("Ratio", dim("Ratio"), "right"),
      mkCell("Confidence", dim("Confidence"), "right"),
    ],
    detailRows,
    { indent: 4 },
  );
  lines.push(detailTable);

  return boxed({
    rows: lines,
    headerRight: dim(`estimate ${glyph.dot} ${results.length} models`),
    footer: faint(`${glyph.spark} ${FOOTER}`),
  });
}

export function renderEstimateJson(results: EstimateResult[], fileName: string): string {
  const output = {
    file: fileName,
    models: results.map((r) => ({
      model: r.model,
      estimatedTokens: r.estimate.tokens,
      characterCount: r.estimate.chars,
      charsPerToken: r.estimate.charsPerToken,
      tokenizerFamily: r.estimate.tokenizerFamily,
      confidence: r.estimate.confidence,
      margin: r.estimate.margin,
      ...(r.estimate.marginTokens !== undefined ? { marginTokens: r.estimate.marginTokens } : {}),
      contentType: r.estimate.contentProfile.contentType,
      contentBucket: r.estimate.contentBucket,
      tokenizerMeasured: r.estimate.measured,
      costUsd: r.costUsd,
      costPerMonth100: r.costUsd !== null ? Math.round(r.costUsd * 100 * 30 * 100) / 100 : null,
      sections: r.sections?.map((s) => ({
        label: s.label,
        tokens: s.tokens,
        chars: s.chars,
        fraction: Math.round(s.fraction * 1000) / 1000,
      })) ?? null,
    })),
  };
  return JSON.stringify(output, null, 2);
}

function renderPlainSingle(result: EstimateResult, fileName: string): string {
  const { estimate, costUsd, sections } = result;
  const lines: string[] = [];

  lines.push("");
  lines.push(`  costcatch estimate`);
  lines.push("");
  lines.push(`  File:       ${fileName}`);
  lines.push(`  Model:      ${result.model}`);
  const content = contentText(estimate);
  lines.push(`  Content:    ${content.label} (${content.family})`);
  lines.push("");
  lines.push(`  Characters: ${estimate.chars.toLocaleString()}`);
  lines.push(`  Tokens:     ~${estimate.tokens.toLocaleString()} (${estimate.confidence}, ${marginText(estimate)})`);
  lines.push("");

  if (costUsd !== null) {
    lines.push(`  Cost (input):`);
    lines.push(`    Per call:       ${formatCost(costUsd)}`);
    lines.push(`    100 calls/day:  ${formatCost(costUsd * 100 * 30)}/mo`);
    lines.push(`    1000 calls/day: ${formatCost(costUsd * 1000 * 30)}/mo`);
  } else {
    lines.push(`  Cost: pricing unavailable`);
  }

  if (sections && sections.length > 0) {
    lines.push("");
    lines.push(`  Breakdown:`);
    lines.push(`  ${"Section".padEnd(32)} ${"Tokens".padStart(8)}  ${"%".padStart(4)}`);
    lines.push(`  ${"-".repeat(32)} ${"-".repeat(8)}  ${"-".repeat(4)}`);
    for (const sec of sections) {
      const pct = Math.round(sec.fraction * 100);
      lines.push(`  ${truncate(sec.label, 32).padEnd(32)} ${sec.tokens.toLocaleString().padStart(8)}  ${(pct + "%").padStart(4)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function renderPlainComparison(results: EstimateResult[], fileName: string): string {
  const lines: string[] = [];
  const chars = results[0]?.estimate.chars ?? 0;

  lines.push("");
  lines.push(`  costcatch estimate  ${results.length} models`);
  lines.push(`  File: ${fileName} (${chars.toLocaleString()} chars)`);
  lines.push("");
  lines.push(`  ${"Model".padEnd(28)} ${"Tokens".padStart(10)}  ${"Cost".padStart(10)}`);
  lines.push(`  ${"-".repeat(28)} ${"-".repeat(10)}  ${"-".repeat(10)}`);

  const sorted = [...results].sort((a, b) => (a.costUsd ?? 0) - (b.costUsd ?? 0));
  for (const r of sorted) {
    const cost = r.costUsd !== null ? formatCost(r.costUsd) : "$?.??";
    lines.push(`  ${truncate(r.model, 28).padEnd(28)} ${("~" + r.estimate.tokens.toLocaleString()).padStart(10)}  ${cost.padStart(10)}`);
  }

  lines.push("");
  return lines.join("\n");
}
