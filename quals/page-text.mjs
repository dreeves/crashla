// How the quals read the page's text without pinning its words (the human's
// rule of 2026-11-03, that no qual turn red on a rewording of text the human
// might edit): an element's text in markup, and the label a mark's name
// carries.

// An element's text as HTML's tokenizer reads it in markup, a regex source:
// every character up to a "<" that opens a tag ("<" and a letter, or "</" and
// a letter); any other "<" is text, as in "Fleet size (<1M cars)". Until the
// second final review of the sixth fix run (2026-11-07) the quals read a text
// up to its first "<", so an axis title holding one read as cut short.
export const MARKUP_TEXT = "(?:[^<]|<(?!\\/?[a-zA-Z]))*";

// The label a chart mark's accessible name carries beside its tip, read for
// the quals that check whose mark is whose on a chart several lines share
// (the MPI, distribution and combined VMT charts, whose marks crashla.js
// names by seriesMarkName), and likewise the lane a tooltip's first line
// names beside its date (the growth trajectory's forecast endpoints).
//
// The name holds the part (a mark's tip, or a date) once, and outside it the
// labels of the chart's lines it holds; the label among them that holds
// every other one is the one it carries ("Tesla (no safety monitor)", not
// "Tesla", for a name holding both). The words between the label and the
// part, and their order, are the page's and free: crashla.js writes
// "<label> · <tip>" today, and the human may write it otherwise (the human's
// rule above). Until the second final review of the sixth fix run
// (2026-11-07) the quals that read these names matched "<label> · <tip>",
// separator and all, so that "<label>: <tip>" turned four of them red.
//
// markLabel(name, part, labels): that label, or undefined where the name
// holds the part other than once, no label, or two labels neither of which
// holds the other.
export function markLabel(name, part, labels) {
  const pieces = name.split(part);
  return pieces.length === 2 ? carriedLabel(pieces.join("\0"), labels) : undefined;
}

// carriedLabel(text, labels): the label a text carries, as markLabel reads
// it outside its part: of the labels the text holds, the one that holds
// every other one; undefined where it holds none, or two neither of which
// holds the other. The growth charts' tooltips are found by it wherever in
// them their words put the lane's label (since 2026-11-07, the main agent
// after the sixth fix run's third final review; until then the quals read
// the label on a tooltip's first line only, so a correct edit of
// crashla.js putting the forecast date on a line of its own turned
// growth-charts and fleet-timeseries red).
export function carriedLabel(text, labels) {
  const held = labels.filter(label => text.includes(label));
  const carried = held.filter(label => held.every(other => label.includes(other)));
  return carried.length === 1 ? carried[0] : undefined;
}

// textOutside(text, ...parts): the text with each part's every occurrence
// replaced by "\0", so that figures read in it are not a label's or a date's
// digits.
export const textOutside = (text, ...parts) => parts.reduce((t, part) => t.split(part).join("\0"), text);

// A whole percent as a text prints it: the digits before a "%" that no digit
// or "." precedes ("93" in "Tesla robotaxi (~93%)", none in "9.3%" or
// "Ratio: 1.5"). percentIn(text) gives the first one's digits, or null where
// the text holds none; holdsPercent(text, n) whether the text holds n%
// (not as a part of "193%"). The growth charts' scenario shares are read by
// them wherever and however a legend label prints them (since 2026-11-07;
// until then only as "(~<n>%)" ending the label, so "Tesla robotaxi, ~93%"
// turned growth-charts and fleet-forecast red).
const PERCENT = /(?<![\d.])(\d+)%/;
export const percentIn = text => {
  const m = PERCENT.exec(text);
  return m === null ? null : m[1];
};
export const holdsPercent = (text, n) => new RegExp(`(?<![\\d.])${n}%`).test(text);
