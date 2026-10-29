#!/bin/bash
# Install a local, separate browser for AIDramio work. No administrator access.
set -euo pipefail
umask 077

AIDRAMIO_MCP_VERSION='0.0.83'
AIDRAMIO_SETUP_VERSION='2'
AIDRAMIO_CODEX_VERSION='0.165.0'
AIDRAMIO_MCP_INTEGRITY='sha512-oNcl+Ae2/IAjhfPeP46BfIkSakfmprY+aOtkv5MjrQ4lPav4/yNtPhL0iq8SlIM90oApWgBDUxaNKvktazUKOg=='
AIDRAMIO_NODE_VERSION='v24.22.2'
AIDRAMIO_TEMP_DIR=''
AIDRAMIO_CURRENT_STEP='checking this Mac'

aidramio_pause() {
  if [ -t 0 ]; then
    printf '\nPress Return to close this installer. '
    IFS= read -r AIDRAMIO_REPLY || true
  fi
}

aidramio_cleanup() {
  if [ -n "$AIDRAMIO_TEMP_DIR" ] && [ -d "$AIDRAMIO_TEMP_DIR" ]; then
    /bin/rm -rf -- "$AIDRAMIO_TEMP_DIR"
  fi
}

aidramio_error() {
  AIDRAMIO_ERROR_CODE="$1"
  trap - ERR
  printf '\nSetup stopped while %s.\n' "$AIDRAMIO_CURRENT_STEP" >&2
  printf 'Read the error above. You can rerun this installer after correcting it.\n' >&2
  printf 'Other MCP entries and your website source were not replaced by this installer.\n' >&2
  aidramio_pause
  exit "$AIDRAMIO_ERROR_CODE"
}

trap aidramio_cleanup EXIT
trap 'aidramio_error "$?"' ERR

if [ "$(/usr/bin/uname -s)" != 'Darwin' ]; then
  printf 'Run this installer on your Mac. It cannot connect a cloud container to your Mac browser.\n' >&2
  exit 1
fi

AIDRAMIO_INSTALL_DIR="${HOME:?Your Mac user home could not be determined}/Library/Application Support/AIDramio/BrowserMCP"
AIDRAMIO_RUNTIME_DIR="$AIDRAMIO_INSTALL_DIR/runtime"
AIDRAMIO_BROWSERS_DIR="$AIDRAMIO_INSTALL_DIR/browsers"
AIDRAMIO_TOOLS_DIR="$AIDRAMIO_INSTALL_DIR/tools"
AIDRAMIO_CACHE_DIR="$AIDRAMIO_INSTALL_DIR/cache"
AIDRAMIO_NPM_CACHE="$AIDRAMIO_INSTALL_DIR/npm-cache"
AIDRAMIO_OUTPUT_DIR="$AIDRAMIO_INSTALL_DIR/output"
AIDRAMIO_PROFILE_DIR="$AIDRAMIO_INSTALL_DIR/browser-profile"
AIDRAMIO_BACKUP_DIR="$AIDRAMIO_INSTALL_DIR/config-backups"
AIDRAMIO_LAUNCHER="$AIDRAMIO_INSTALL_DIR/start-browser-mcp.command"
AIDRAMIO_ORIGINAL_PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

/bin/mkdir -p "$AIDRAMIO_INSTALL_DIR" "$AIDRAMIO_RUNTIME_DIR" "$AIDRAMIO_BROWSERS_DIR" \
  "$AIDRAMIO_TOOLS_DIR" "$AIDRAMIO_CACHE_DIR" "$AIDRAMIO_NPM_CACHE" "$AIDRAMIO_OUTPUT_DIR" \
  "$AIDRAMIO_PROFILE_DIR" "$AIDRAMIO_BACKUP_DIR"
/bin/chmod 700 "$AIDRAMIO_INSTALL_DIR" "$AIDRAMIO_RUNTIME_DIR" "$AIDRAMIO_BROWSERS_DIR" \
  "$AIDRAMIO_TOOLS_DIR" "$AIDRAMIO_CACHE_DIR" "$AIDRAMIO_NPM_CACHE" "$AIDRAMIO_OUTPUT_DIR" \
  "$AIDRAMIO_PROFILE_DIR" "$AIDRAMIO_BACKUP_DIR"
AIDRAMIO_TEMP_DIR="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/aidramio-mcp.XXXXXX")"

AIDRAMIO_VERIFY_SOURCE="$AIDRAMIO_TEMP_DIR/verify-mcp.mjs"
/bin/cat > "$AIDRAMIO_VERIFY_SOURCE" <<'AIDRAMIO_MCP_VERIFY_SOURCE'
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

const [command,...args]=process.argv.slice(2);
if(!command){console.error('Usage: node verify-mcp.mjs <server-command> [server arguments...]');process.exit(2);}
const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],env:process.env});
const pending=new Map();let nextId=0;let buffer='';let stderr='';let initialized=false;let verified=false;
const redact=value=>String(value).replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g,'https://[redacted]@').replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b/g,'[redacted]').replace(/\b(?:sk-proj-|sk-ant-|ghp_|github_pat_)[A-Za-z0-9_-]+\b/g,'[redacted]');
function failPending(error){for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();}
child.on('error',error=>failPending(error));
child.on('exit',code=>failPending(new Error('MCP process exited with code '+code)));
child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-5000);});
child.stdout.on('data',chunk=>{
  buffer+=chunk.toString();
  for(let index;(index=buffer.indexOf('\n'))>=0;){
    const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
    let message;try{message=JSON.parse(line);}catch{continue;}
    if(!pending.has(message.id))continue;
    const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);
    if(message.error)item.reject(new Error('MCP protocol error: '+message.error.message));else item.resolve(message.result);
  }
});
function request(method,params={}){
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timed out waiting for '+method));},30000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });
}
async function tool(name,arguments_={}){
  const result=await request('tools/call',{name,arguments:arguments_});
  if(result?.isError)throw new Error(name+' failed: '+redact((result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n')).slice(0,1200));
  return result;
}
function text(result){return(result?.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');}
try{
  const hello=await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'aidramio-browser-setup-check',version:'1.0.0'}});
  initialized=true;child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
  const listed=await request('tools/list');const names=(listed.tools||[]).map(item=>item.name);
  for(const name of ['browser_navigate','browser_snapshot','browser_click','browser_evaluate','browser_close'])if(!names.includes(name))throw new Error('Required browser tool missing: '+name);
  await tool('browser_navigate',{url:'about:blank'});
  await tool('browser_evaluate',{function:"() => { document.title = 'AIDramio MCP verification'; document.body.innerHTML = ''; const b = document.createElement('button'); b.id = 'aidramio-mcp-check'; b.textContent = 'Verify MCP'; b.onclick = () => { b.textContent = 'Clicked'; }; document.body.appendChild(b); return document.title; }"});
  const snapshot=text(await tool('browser_snapshot'));
  const line=snapshot.split('\n').find(value=>value.includes('button')&&value.includes('Verify MCP'));
  const ref=line?.match(/\[ref=([^\]]+)\]/)?.[1];if(!ref)throw new Error('Browser inspection did not find the test button.');
  const clickSchema=listed.tools.find(item=>item.name==='browser_click').inputSchema;
  const targetArgument=clickSchema.properties?.target?{target:ref}:{ref};
  await tool('browser_click',{element:'Verify MCP test button',...targetArgument});
  const after=text(await tool('browser_evaluate',{function:"() => document.getElementById('aidramio-mcp-check').textContent"}));
  if(!after.includes('Clicked'))throw new Error('Browser click verification failed.');
  verified=true;
  const summary={ok:true,server:hello.serverInfo,protocol:hello.protocolVersion,toolCount:names.length,navigate:true,inspect:true,click:true,scope:'This process and its separate test browser; desktop attachment is checked after restart.'};
  console.log(JSON.stringify(summary,null,2));
  if(process.env.AIDRAMIO_MCP_REPORT)await fs.writeFile(process.env.AIDRAMIO_MCP_REPORT,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
}catch(error){
  console.error(redact(error.message));if(stderr.trim())console.error(redact(stderr).slice(-1800));process.exitCode=1;
}finally{
  if(initialized)await tool('browser_close').catch(()=>{});
  failPending(new Error('Setup check finished.'));
  child.stdin.end();
  if(child.exitCode===null){await new Promise(resolve=>{const timer=setTimeout(resolve,1000);child.once('exit',()=>{clearTimeout(timer);resolve();});});if(child.exitCode===null)child.kill('SIGTERM');}
  if(!verified)process.exitCode=1;
}

AIDRAMIO_MCP_VERIFY_SOURCE

printf 'AIDramio local browser setup (v%s)\n' "$AIDRAMIO_SETUP_VERSION"
printf 'Install location: %s\n\n' "$AIDRAMIO_INSTALL_DIR"
printf 'The browser tools require Node.js 20 or newer; checking available runtimes.\n'

# Finder-launched apps often have a shorter PATH than Terminal. Check real files.
AIDRAMIO_NODE=''
AIDRAMIO_NPM=''
AIDRAMIO_NPX=''
AIDRAMIO_NODE_CANDIDATES=()
AIDRAMIO_NODE_ON_PATH="$(command -v node || true)"
if [ -n "$AIDRAMIO_NODE_ON_PATH" ]; then
  AIDRAMIO_NODE_CANDIDATES+=("$AIDRAMIO_NODE_ON_PATH")
fi
AIDRAMIO_NODE_CANDIDATES+=(
  '/opt/homebrew/bin/node'
  '/usr/local/bin/node'
  '/opt/homebrew/opt/node@24/bin/node'
  '/opt/homebrew/opt/node@22/bin/node'
  '/opt/homebrew/opt/node@20/bin/node'
  "$AIDRAMIO_TOOLS_DIR/node-$AIDRAMIO_NODE_VERSION-darwin-arm64/bin/node"
  "$AIDRAMIO_TOOLS_DIR/node-$AIDRAMIO_NODE_VERSION-darwin-x64/bin/node"
)

for AIDRAMIO_CANDIDATE in "${AIDRAMIO_NODE_CANDIDATES[@]}"; do
  [ -x "$AIDRAMIO_CANDIDATE" ] || continue
  if ! "$AIDRAMIO_CANDIDATE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
    continue
  fi
  AIDRAMIO_CANDIDATE_BIN="$(dirname -- "$AIDRAMIO_CANDIDATE")"
  AIDRAMIO_CANDIDATE_PATH="$AIDRAMIO_CANDIDATE_BIN:$AIDRAMIO_ORIGINAL_PATH:/usr/bin:/bin:/usr/sbin:/sbin"
  AIDRAMIO_CANDIDATE_NPM="$AIDRAMIO_CANDIDATE_BIN/npm"
  AIDRAMIO_CANDIDATE_NPX="$AIDRAMIO_CANDIDATE_BIN/npx"
  if [ ! -x "$AIDRAMIO_CANDIDATE_NPM" ]; then
    AIDRAMIO_CANDIDATE_NPM="$(command -v npm || true)"
  fi
  if [ ! -x "$AIDRAMIO_CANDIDATE_NPX" ]; then
    AIDRAMIO_CANDIDATE_NPX="$(command -v npx || true)"
  fi
  if [ -n "$AIDRAMIO_CANDIDATE_NPM" ] && [ -x "$AIDRAMIO_CANDIDATE_NPM" ] && \
     [ -n "$AIDRAMIO_CANDIDATE_NPX" ] && [ -x "$AIDRAMIO_CANDIDATE_NPX" ] && \
     /usr/bin/env PATH="$AIDRAMIO_CANDIDATE_PATH" "$AIDRAMIO_CANDIDATE_NPM" --version >/dev/null 2>&1; then
    AIDRAMIO_NODE="$AIDRAMIO_CANDIDATE"
    AIDRAMIO_NPM="$AIDRAMIO_CANDIDATE_NPM"
    AIDRAMIO_NPX="$AIDRAMIO_CANDIDATE_NPX"
    break
  fi
done

if [ -z "$AIDRAMIO_NODE" ]; then
  AIDRAMIO_CURRENT_STEP='installing a private Node.js runtime'
  case "$(/usr/bin/uname -m)" in
    arm64)
      AIDRAMIO_NODE_ARCH='arm64'
      AIDRAMIO_NODE_SHA256='aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a'
      ;;
    x86_64)
      AIDRAMIO_NODE_ARCH='x64'
      AIDRAMIO_NODE_SHA256='d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52'
      ;;
    *)
      printf 'Unsupported Mac architecture. Install Node.js 20+ from https://nodejs.org/ and rerun.\n' >&2
      aidramio_pause
      exit 1
      ;;
  esac
  AIDRAMIO_NODE_NAME="node-$AIDRAMIO_NODE_VERSION-darwin-$AIDRAMIO_NODE_ARCH"
  AIDRAMIO_NODE_ARCHIVE="$AIDRAMIO_TEMP_DIR/$AIDRAMIO_NODE_NAME.tar.gz"
  printf 'Installing official Node.js %s privately; no administrator password is needed.\n' "$AIDRAMIO_NODE_VERSION"
  /usr/bin/curl -q --fail --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 180 --retry 2 \
    "https://nodejs.org/dist/$AIDRAMIO_NODE_VERSION/$AIDRAMIO_NODE_NAME.tar.gz" \
    --output "$AIDRAMIO_NODE_ARCHIVE"
  AIDRAMIO_ACTUAL_SHA256="$(/usr/bin/shasum -a 256 "$AIDRAMIO_NODE_ARCHIVE")"
  AIDRAMIO_ACTUAL_SHA256="${AIDRAMIO_ACTUAL_SHA256%% *}"
  if [ "$AIDRAMIO_ACTUAL_SHA256" != "$AIDRAMIO_NODE_SHA256" ]; then
    printf 'The Node.js download checksum did not match. Setup will not run that download.\n' >&2
    aidramio_pause
    exit 1
  fi
  /usr/bin/tar -xzf "$AIDRAMIO_NODE_ARCHIVE" -C "$AIDRAMIO_TOOLS_DIR"
  AIDRAMIO_NODE="$AIDRAMIO_TOOLS_DIR/$AIDRAMIO_NODE_NAME/bin/node"
  AIDRAMIO_NPM="$AIDRAMIO_TOOLS_DIR/$AIDRAMIO_NODE_NAME/bin/npm"
  AIDRAMIO_NPX="$AIDRAMIO_TOOLS_DIR/$AIDRAMIO_NODE_NAME/bin/npx"
  if ! "$AIDRAMIO_NODE" --version; then
    printf 'This private Node.js 24 runtime requires macOS 13.5 or later.\n' >&2
    printf 'On older supported Macs, install a compatible Node.js 20+ release from https://nodejs.org/ and rerun.\n' >&2
    aidramio_pause
    exit 1
  fi
fi

AIDRAMIO_NODE_BIN="$(dirname -- "$AIDRAMIO_NODE")"
AIDRAMIO_TASK_PATH="$AIDRAMIO_NODE_BIN:$AIDRAMIO_ORIGINAL_PATH:/usr/bin:/bin:/usr/sbin:/sbin"
printf 'Using Node.js %s\n' "$("$AIDRAMIO_NODE" --version)"

AIDRAMIO_CURRENT_STEP='installing the pinned Playwright MCP package'
printf '\n1/4 Installing Microsoft Playwright MCP %s...\n' "$AIDRAMIO_MCP_VERSION"
/usr/bin/env PATH="$AIDRAMIO_TASK_PATH" "$AIDRAMIO_NPM" install \
  --prefix "$AIDRAMIO_RUNTIME_DIR" --cache "$AIDRAMIO_NPM_CACHE" \
  --registry 'https://registry.npmjs.org/' --ignore-scripts --save-exact \
  --no-audit --no-fund --fetch-retries=1 --fetch-timeout=60000 \
  "@playwright/mcp@$AIDRAMIO_MCP_VERSION"

# Confirm the installed direct package matches the previously verified npm release.
"$AIDRAMIO_NODE" - "$AIDRAMIO_RUNTIME_DIR" "$AIDRAMIO_MCP_VERSION" "$AIDRAMIO_MCP_INTEGRITY" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [runtime, version, integrity] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(runtime, 'node_modules/@playwright/mcp/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(runtime, 'package-lock.json'), 'utf8'));
if (pkg.name !== '@playwright/mcp' || pkg.version !== version || lock.packages?.['node_modules/@playwright/mcp']?.integrity !== integrity) {
  throw new Error('Installed Playwright MCP version or integrity did not match the verified release.');
}
NODE

AIDRAMIO_MCP_CLI="$("$AIDRAMIO_NODE" - "$AIDRAMIO_RUNTIME_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.argv[2];
const packagePath = require.resolve('@playwright/mcp/package.json', { paths: [runtime] });
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['playwright-mcp'];
if (!relative) throw new Error('The installed MCP package has no expected CLI entry.');
console.log(path.resolve(path.dirname(packagePath), relative));
NODE
)"
AIDRAMIO_PLAYWRIGHT_CLI="$("$AIDRAMIO_NODE" - "$AIDRAMIO_RUNTIME_DIR" <<'NODE'
const path = require('node:path');
const packagePath = require.resolve('playwright/package.json', { paths: [process.argv[2]] });
console.log(path.join(path.dirname(packagePath), 'cli.js'));
NODE
)"

AIDRAMIO_CURRENT_STEP='installing the separate Chromium browser'
printf '\n2/4 Downloading the matching Chromium browser...\n'
/usr/bin/env PATH="$AIDRAMIO_TASK_PATH" PLAYWRIGHT_BROWSERS_PATH="$AIDRAMIO_BROWSERS_DIR" \
  XDG_CACHE_HOME="$AIDRAMIO_CACHE_DIR" \
  "$AIDRAMIO_NODE" "$AIDRAMIO_PLAYWRIGHT_CLI" install chromium
AIDRAMIO_CHROMIUM="$(/usr/bin/env PLAYWRIGHT_BROWSERS_PATH="$AIDRAMIO_BROWSERS_DIR" \
  "$AIDRAMIO_NODE" - "$AIDRAMIO_RUNTIME_DIR" <<'NODE'
const { createRequire } = require('node:module');
const path = require('node:path');
const fromRuntime = createRequire(path.join(process.argv[2], 'package.json'));
console.log(fromRuntime('playwright').chromium.executablePath());
NODE
)"
if [ ! -x "$AIDRAMIO_CHROMIUM" ]; then
  printf 'Chromium was not found after its installer completed.\n' >&2
  exit 1
fi

# A direct absolute Node command works even with a restricted desktop-app PATH.
{
  printf '#!/bin/bash\nset -euo pipefail\numask 077\n'
  printf 'export PLAYWRIGHT_BROWSERS_PATH=%q\n' "$AIDRAMIO_BROWSERS_DIR"
  printf 'export XDG_CACHE_HOME=%q\n' "$AIDRAMIO_CACHE_DIR"
  printf 'exec %q %q --executable-path %q --user-data-dir %q --output-dir %q "$@"\n' \
    "$AIDRAMIO_NODE" "$AIDRAMIO_MCP_CLI" "$AIDRAMIO_CHROMIUM" "$AIDRAMIO_PROFILE_DIR" "$AIDRAMIO_OUTPUT_DIR"
} > "$AIDRAMIO_LAUNCHER"
/bin/chmod 700 "$AIDRAMIO_LAUNCHER"
/bin/bash -n "$AIDRAMIO_LAUNCHER"
if [ "$AIDRAMIO_VERIFY_SOURCE" != "$AIDRAMIO_INSTALL_DIR/verify-mcp.mjs" ]; then
  /bin/cp "$AIDRAMIO_VERIFY_SOURCE" "$AIDRAMIO_INSTALL_DIR/verify-mcp.mjs"
fi
/bin/chmod 600 "$AIDRAMIO_INSTALL_DIR/verify-mcp.mjs"

AIDRAMIO_CURRENT_STEP='verifying MCP startup, inspection and clicks'
printf '\n3/4 Checking MCP startup and browser navigate/inspect/click tools...\n'
/usr/bin/env PATH="$AIDRAMIO_TASK_PATH" PLAYWRIGHT_BROWSERS_PATH="$AIDRAMIO_BROWSERS_DIR" \
  XDG_CACHE_HOME="$AIDRAMIO_CACHE_DIR" AIDRAMIO_MCP_REPORT="$AIDRAMIO_INSTALL_DIR/verification.json" \
  "$AIDRAMIO_NODE" "$AIDRAMIO_INSTALL_DIR/verify-mcp.mjs" \
  "$AIDRAMIO_NODE" "$AIDRAMIO_MCP_CLI" --headless --executable-path "$AIDRAMIO_CHROMIUM" \
  --user-data-dir "$AIDRAMIO_TEMP_DIR/verification-profile" --output-dir "$AIDRAMIO_TEMP_DIR/verification-output"

AIDRAMIO_CURRENT_STEP='registering the local Codex MCP server'
printf '\n4/4 Registering the playwright MCP entry on this Mac...\n'
AIDRAMIO_CODEX_CONFIG_DIR="${CODEX_HOME:-${HOME}/.codex}"
if [ -f "$AIDRAMIO_CODEX_CONFIG_DIR/config.toml" ]; then
  AIDRAMIO_CONFIG_BACKUP="$(/usr/bin/mktemp "$AIDRAMIO_BACKUP_DIR/config.toml.XXXXXX")"
  /bin/cp "$AIDRAMIO_CODEX_CONFIG_DIR/config.toml" "$AIDRAMIO_CONFIG_BACKUP"
  /bin/chmod 600 "$AIDRAMIO_CONFIG_BACKUP"
  printf 'Saved a private backup of the existing configuration.\n'
fi

AIDRAMIO_CODEX=''
AIDRAMIO_CODEX_ON_PATH="$(command -v codex || true)"
for AIDRAMIO_CANDIDATE in "$AIDRAMIO_CODEX_ON_PATH" \
  '/opt/homebrew/bin/codex' '/usr/local/bin/codex' \
  '/Applications/Codex.app/Contents/Resources/codex' \
  '/Applications/ChatGPT.app/Contents/Resources/codex'; do
  if [ -n "$AIDRAMIO_CANDIDATE" ] && [ -x "$AIDRAMIO_CANDIDATE" ] && \
     /usr/bin/env PATH="$AIDRAMIO_TASK_PATH" "$AIDRAMIO_CANDIDATE" mcp --help >/dev/null 2>&1; then
    AIDRAMIO_CODEX="$AIDRAMIO_CANDIDATE"
    break
  fi
done

if [ -n "$AIDRAMIO_CODEX" ]; then
  /usr/bin/env PATH="$AIDRAMIO_TASK_PATH" "$AIDRAMIO_CODEX" mcp add playwright -- "$AIDRAMIO_LAUNCHER"
else
  printf 'Using the official pinned Codex CLI %s for local registration.\n' "$AIDRAMIO_CODEX_VERSION"
  /usr/bin/env PATH="$AIDRAMIO_TASK_PATH" "$AIDRAMIO_NPX" --yes --cache "$AIDRAMIO_NPM_CACHE" \
    --registry 'https://registry.npmjs.org/' --package "@openai/codex@$AIDRAMIO_CODEX_VERSION" \
    codex mcp add playwright -- "$AIDRAMIO_LAUNCHER"
fi

printf '\nInstalled and verified: MCP startup, browser navigation, inspection and clicks.\n'
printf 'A separate headed browser will open when the local agent first uses Playwright.\n'
printf 'Its sign-in state stays in your private AIDramio browser profile on this Mac.\n'
printf '\nNext: open Settings > MCP servers, select playwright, and select Restart.\n'
printf 'Continue in a chat using this Mac/local computer, then ask the agent to use Playwright.\n'
printf 'If prompted, sign in to Apple yourself in the new browser window.\n'
printf '\nThis does not attach the built-in ChatGPT side tab or repair Apple client registration.\n'
printf 'A cloud-only chat does not automatically inherit this Mac MCP configuration.\n'
printf 'Verification report: %s/verification.json\n' "$AIDRAMIO_INSTALL_DIR"
aidramio_pause
