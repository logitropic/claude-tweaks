import { type PatchContext } from "../patch-utils.ts";

const CHROME_MCP_DISALLOWED_TOOLS =
  ',"mcp__Claude_in_Chrome__tabs_context_mcp","mcp__Claude_in_Chrome__tabs_create_mcp","mcp__Claude_in_Chrome__tabs_close_mcp","mcp__Claude_in_Chrome__navigate","mcp__Claude_in_Chrome__computer","mcp__Claude_in_Chrome__find","mcp__Claude_in_Chrome__read_page","mcp__Claude_in_Chrome__get_page_text","mcp__Claude_in_Chrome__form_input","mcp__Claude_in_Chrome__file_upload","mcp__Claude_in_Chrome__upload_image","mcp__Claude_in_Chrome__javascript_tool","mcp__Claude_in_Chrome__read_console_messages","mcp__Claude_in_Chrome__read_network_requests","mcp__Claude_in_Chrome__resize_window","mcp__Claude_in_Chrome__gif_creator","mcp__Claude_in_Chrome__shortcuts_list","mcp__Claude_in_Chrome__shortcuts_execute","mcp__Claude_in_Chrome__switch_browser"';

export function patchChromeMcp(ctx: PatchContext): Buffer {
  let text = ctx.content.toString("utf8");
  text = replaceAll(text, "A.shouldEnableChromeExtensionBridge()&&S5r()", "false&&S5r()", ctx.log, "disable Claude in Chrome MCP bridge startup");
  text = replaceRegex(text, /false&&S5r\(\)\s+(?=,)/g, "false&&S5r()", ctx.log, "trim previously padded Chrome MCP bridge startup patch");

  text = replaceAll(text, "...Ea?[]:[KiA.slice(0,-2)]", "...[]", ctx.log, "remove Claude in Chrome MCP tools from allowed tool prefix");
  text = replaceRegex(text, /\.\.\.\[\]\s+(?=,)/g, "...[]", ctx.log, "trim previously padded Claude in Chrome MCP allowed tool prefix");

  text = replaceAll(text, CHROME_MCP_DISALLOWED_TOOLS, "", ctx.log, "remove hard-coded Claude in Chrome MCP tool names from session tool lists");

  text = replaceAll(
    text,
    'sb="Claude in Chrome",z1i="Claude_in_Chrome",KiA=`mcp__${z1i}__`',
    'sb="",z1i="",KiA="__claude_tweaks_disabled__"',
    ctx.log,
    "remove Claude in Chrome MCP namespace constants",
  );

  {
    const start = text.indexOf('const gqi="javascript_tool"');
    if (start === -1) {
      ctx.log("skip remove Claude in Chrome MCP tool schema definitions; start pattern not found in this version");
    } else {
      const end = text.indexOf(";function yt", start);
      if (end === -1) {
        ctx.log("skip remove Claude in Chrome MCP tool schema definitions; end pattern not found in this version");
      } else {
        ctx.log("remove Claude in Chrome MCP tool schema definitions");
        text = text.slice(0, start) + 'const gqi="",ugt=new Set([]),cqi=new Set([]),lqi="";function k8A(){return""}const uxA=[]' + text.slice(end);
      }
    }
  }

  text = replaceAll(text, "mcp__Claude_in_Chrome__*", "browser tools", ctx.log, "remove Claude in Chrome MCP prompt examples");
  for (const value of ["Claude_in_Chrome", "Claude-in-Chrome"]) {
    text = replaceAll(text, value, "browser", ctx.log, `remove ${value} references`);
  }
  text = replaceAll(text, "Claude in Chrome", "browser", ctx.log, "remove Claude in Chrome display names");

  return Buffer.from(text);
}

function replaceAll(text: string, oldValue: string, newValue: string, log: PatchContext["log"], label: string) {
  const count = text.split(oldValue).length - 1;
  if (count === 0) {
    log(`skip ${label}; pattern not found in this version`);
    return text;
  }
  log(`${label}${count > 1 ? ` (${count} matches)` : ""}`);
  return text.replaceAll(oldValue, newValue);
}

function replaceRegex(text: string, pattern: RegExp, newValue: string, log: PatchContext["log"], label: string) {
  const matches = text.match(pattern);
  if (!matches) {
    log(`skip ${label}; pattern not found in this version`);
    return text;
  }
  log(`${label}${matches.length > 1 ? ` (${matches.length} matches)` : ""}`);
  return text.replace(pattern, newValue);
}
