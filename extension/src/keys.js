const SPECIAL = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
};

const PLAIN = {
  " ": [" ", "Space", 32],
  "-": ["-", "Minus", 189],
  "=": ["=", "Equal", 187],
  "[": ["[", "BracketLeft", 219],
  "]": ["]", "BracketRight", 221],
  "\\": ["\\", "Backslash", 220],
  ";": [";", "Semicolon", 186],
  "'": ["'", "Quote", 222],
  ",": [",", "Comma", 188],
  ".": [".", "Period", 190],
  "/": ["/", "Slash", 191],
  "`": ["`", "Backquote", 192],
};

const SHIFTED = {
  "!": ["1", "Digit1", 49],
  "@": ["2", "Digit2", 50],
  "#": ["3", "Digit3", 51],
  $: ["4", "Digit4", 52],
  "%": ["5", "Digit5", 53],
  "^": ["6", "Digit6", 54],
  "&": ["7", "Digit7", 55],
  "*": ["8", "Digit8", 56],
  "(": ["9", "Digit9", 57],
  ")": ["0", "Digit0", 48],
  _: ["-", "Minus", 189],
  "+": ["=", "Equal", 187],
  "{": ["[", "BracketLeft", 219],
  "}": ["]", "BracketRight", 221],
  "|": ["\\", "Backslash", 220],
  ":": [";", "Semicolon", 186],
  '"': ["'", "Quote", 222],
  "<": [",", "Comma", 188],
  ">": [".", "Period", 190],
  "?": ["/", "Slash", 191],
  "~": ["`", "Backquote", 192],
};

function definition(key, code, vk, text, modifiers = 0) {
  return { key, code, vk, text, modifiers };
}

export function keyDefinition(char) {
  if (char === "\n" || char === "\r") return SPECIAL.Enter;
  if (/^[a-z]$/.test(char)) {
    return definition(char, `Key${char.toUpperCase()}`, char.toUpperCase().charCodeAt(0), char, 0);
  }
  if (/^[A-Z]$/.test(char)) {
    return definition(char, `Key${char}`, char.charCodeAt(0), char, 8);
  }
  if (/^[0-9]$/.test(char)) {
    return definition(char, `Digit${char}`, 48 + Number(char), char, 0);
  }
  if (PLAIN[char]) {
    const [key, code, vk] = PLAIN[char];
    return definition(key, code, vk, char, 0);
  }
  if (SHIFTED[char]) {
    const [key, code, vk] = SHIFTED[char];
    return definition(char, code, vk, char, 8);
  }
  return null;
}

export { SPECIAL };
