import { fixedLengthBuffer, patchSameLengthPattern, type PatchContext } from "../patch-utils.ts";

const CU_ENABLED_OLD = Buffer.from('function oT(){return lIA.has(process.platform)?uIA()&&ui("chicagoEnabled"):!1}');
const CU_ENABLED_NEW = fixedLengthBuffer("function oT(){return!0}", CU_ENABLED_OLD.length);
const CU_OPTOUT_OLD = Buffer.from('function hVA(){return lIA.has(process.platform)&&uIA()&&!ui("chicagoEnabled")}');
const CU_OPTOUT_NEW = fixedLengthBuffer("function hVA(){return!1}", CU_OPTOUT_OLD.length);
const CU_TCC_OLD = Buffer.from(
  'async function hGA(){if(process.platform==="win32")return{granted:!0};let e;try{e=await cl()}catch(i){return S.error("[computer-use] ensureOsPermissions: claude-swift computerUse unavailable",i),{granted:!1,accessibility:!1,screenRecording:!1}}const A=e.tcc.checkAccessibility(),t=e.tcc.checkScreenRecording();return A&&t?{granted:!0}:{granted:!1,accessibility:A,screenRecording:t}}',
);
const CU_TCC_NEW = fixedLengthBuffer(
  "async function hGA(){return{granted:!0,accessibility:!0,screenRecording:!0}}",
  CU_TCC_OLD.length,
);
const CU_DISABLED_OLD = Buffer.from("isDisabled:()=>!oT()");
const CU_DISABLED_NEW = Buffer.from("isDisabled:()=>false");

export function patchComputerUse(ctx: PatchContext): Buffer {
  let content = ctx.content;
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: CU_ENABLED_OLD,
    newBytes: CU_ENABLED_NEW,
    alreadyBytes: CU_ENABLED_NEW,
    label: "force Computer Use feature enabled",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: CU_OPTOUT_OLD,
    newBytes: CU_OPTOUT_NEW,
    alreadyBytes: CU_OPTOUT_NEW,
    label: "disable Computer Use opt-out stub gate",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: CU_TCC_OLD,
    newBytes: CU_TCC_NEW,
    alreadyBytes: CU_TCC_NEW,
    label: "bypass Computer Use TCC permission gate",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: CU_DISABLED_OLD,
    newBytes: CU_DISABLED_NEW,
    alreadyBytes: CU_DISABLED_NEW,
    label: "bypass Computer Use disabled setting gate",
  });
  return content;
}
