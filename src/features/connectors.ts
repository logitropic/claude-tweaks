import { fixedLengthBuffer, patchSameLengthPattern, type PatchContext } from "../patch-utils.ts";

const PLUGIN_STATE_OLD = Buffer.from("const i=await l8A(A.accountId,A.orgId).catch(()=>({})),r=[];");
const PLUGIN_STATE_NEW = fixedLengthBuffer(
  "const i=(await ih(Uh(A.accountId,A.orgId))).plugins,r=[];",
  PLUGIN_STATE_OLD.length,
);

const PLUGIN_ENABLED_OLD = Buffer.from("if(i[`${s}@${qC}`]!==!0)continue;");
const PLUGIN_ENABLED_NEW = fixedLengthBuffer("if(!i[`${s}@${qC}`])continue;", PLUGIN_ENABLED_OLD.length);

const ORG_PLUGIN_OAUTH_OLD = Buffer.from(
  'function zk(A){return(A.transport==="http"||A.transport==="sse")&&!!A.oauth}',
);
const ORG_PLUGIN_OAUTH_NEW = fixedLengthBuffer(
  'function zk(A){return!!A.oauth||A.source==="org-plugin"}',
  ORG_PLUGIN_OAUTH_OLD.length,
);

const CONNECT_OAUTH_OLD = Buffer.from("if(!A.oauth)return qst(A);");
const CONNECT_OAUTH_NEW = fixedLengthBuffer("if(!zk(A))return qst(A);", CONNECT_OAUTH_OLD.length);

const SESSION_CACHE_OLD = Buffer.from(
  'const Jd="custom3pMcpOAuth",sKi=new Set(["login.microsoftonline.com","login.microsoftonline.us"]),aKi=60,gKi=24*3600;',
);
const SESSION_CACHE_NEW = fixedLengthBuffer(
  'const Jd="custom3pMcpOAuth",m={},sKi={has:A=>/^login\\.microsoftonline\\.(com|us)$/.test(A)},aKi=60,gKi=86400;',
  SESSION_CACHE_OLD.length,
);

const TOKEN_READ_OLD = Buffer.from(
  'function p$(A){const e=mr.get(Jd),t=e==null?void 0:e[A];if(!(t!=null&&t.tokens))return{kind:"missing"};try{const i=oA.safeStorage.decryptString(Buffer.from(t.tokens,"base64")),r=JSON.parse(i);return r.access_token?{kind:"ok",bearer:r.access_token,expiresAt:t.expiresAt,hasRefresh:!!r.refresh_token}:{kind:"missing"}}catch{return{kind:"locked",expiresAt:t.expiresAt}}}function HMA(A){return(A==null?void 0:A.split(/\\s+/).filter(Boolean).sort().join(" "))||void 0}',
);
const TOKEN_READ_NEW = fixedLengthBuffer(
  'function p$(A){const e=mr.get(Jd),t=m[A]??e?.[A];if(!t?.tokens)return{kind:"missing"};try{const r=typeof t.tokens=="object"?t.tokens:JSON.parse(oA.safeStorage.decryptString(Buffer.from(t.tokens,"base64")));return r.access_token?{kind:"ok",bearer:r.access_token,expiresAt:t.expiresAt,hasRefresh:!!r.refresh_token}:{kind:"missing"}}catch{return{kind:"locked",expiresAt:t.expiresAt}}}function HMA(A){return A?.split(/\\s+/).filter(Boolean).sort().join(" ")||void 0}',
  TOKEN_READ_OLD.length,
);

const ENCRYPTED_STORE_OLD = Buffer.from(
  'readEncrypted(e){var r;const t=mr.get(Jd),i=(r=t==null?void 0:t[this.serverName])==null?void 0:r[e];if(i)try{const n=oA.safeStorage.decryptString(Buffer.from(i,"base64"));return JSON.parse(n)}catch(n){if(D.warn("[custom3p-mcp] decrypt failed",{server:this.serverName,field:e,cleared:!this.nonDestructiveReads,error:n instanceof Error?n.message:String(n)}),this.nonDestructiveReads)throw new h5;this.clearField(e);return}}writeEncrypted(e,t){if(!oA.safeStorage.isEncryptionAvailable())return D.warn("[custom3p-mcp] safeStorage unavailable; not persisted",{server:this.serverName,field:e}),!1;try{const i=mr.get(Jd)??{},r=i[this.serverName]??{};return r[e]=oA.safeStorage.encryptString(JSON.stringify(t)).toString("base64"),i[this.serverName]=r,mr.set(Jd,i),!0}catch(i){return D.warn("[custom3p-mcp] encrypt failed; not persisted",{server:this.serverName,field:e,error:i instanceof Error?i.message:String(i)}),!1}}',
);
const ENCRYPTED_STORE_NEW = fixedLengthBuffer(
  'readEncrypted(e){var r;const t=mr.get(Jd),i=m[this.serverName]?.[e]??((r=t==null?void 0:t[this.serverName])==null?void 0:r[e]);if(typeof i=="object")return i;if(i)try{return JSON.parse(oA.safeStorage.decryptString(Buffer.from(i,"base64")))}catch(n){if(this.nonDestructiveReads)throw new h5;this.clearField(e);return}}writeEncrypted(e,t){if(!oA.safeStorage.isEncryptionAvailable()){const i=m[this.serverName]??{};return i[e]=t,m[this.serverName]=i,D.warn("[custom3p-mcp] session-only",{server:this.serverName,field:e}),!0}try{const i=mr.get(Jd)??{},r=i[this.serverName]??{};return r[e]=oA.safeStorage.encryptString(JSON.stringify(t)).toString("base64"),i[this.serverName]=r,mr.set(Jd,i),!0}catch(i){return D.warn("[custom3p-mcp] encrypt failed",{server:this.serverName,field:e}),!1}}',
  ENCRYPTED_STORE_OLD.length,
);

export function patchConnectors(ctx: PatchContext): Buffer {
  let content = ctx.content;
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: PLUGIN_STATE_OLD,
    newBytes: PLUGIN_STATE_NEW,
    alreadyBytes: PLUGIN_STATE_NEW,
    label: "use installed org plugins for custom 3P MCP discovery",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: PLUGIN_ENABLED_OLD,
    newBytes: PLUGIN_ENABLED_NEW,
    alreadyBytes: PLUGIN_ENABLED_NEW,
    label: "treat installed org plugins as custom 3P MCP-enabled",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: ORG_PLUGIN_OAUTH_OLD,
    newBytes: ORG_PLUGIN_OAUTH_NEW,
    alreadyBytes: ORG_PLUGIN_OAUTH_NEW,
    label: "route org-plugin remote MCP servers through custom 3P OAuth",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: CONNECT_OAUTH_OLD,
    newBytes: CONNECT_OAUTH_NEW,
    alreadyBytes: CONNECT_OAUTH_NEW,
    label: "use custom 3P OAuth for org-plugin MCP connect clicks",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: SESSION_CACHE_OLD,
    newBytes: SESSION_CACHE_NEW,
    alreadyBytes: SESSION_CACHE_NEW,
    label: "add session-only custom 3P MCP OAuth cache",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: TOKEN_READ_OLD,
    newBytes: TOKEN_READ_NEW,
    alreadyBytes: TOKEN_READ_NEW,
    label: "read session-only custom 3P MCP OAuth tokens",
  });
  content = patchSameLengthPattern({
    ...ctx,
    content,
    oldBytes: ENCRYPTED_STORE_OLD,
    newBytes: ENCRYPTED_STORE_NEW,
    alreadyBytes: ENCRYPTED_STORE_NEW,
    label: "cache custom 3P MCP OAuth credentials in memory when safeStorage is unavailable",
  });
  return content;
}
