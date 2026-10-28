#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEVECO_DIR="${DEVECO_DIR:-/Applications/DevEco-Studio.app/Contents}"
export JAVA_HOME="$DEVECO_DIR/jbr/Contents/Home"
export DEVECO_SDK_HOME="$DEVECO_DIR/sdk"
export PATH="$DEVECO_DIR/tools/node/bin:$DEVECO_DIR/tools/ohpm/bin:$JAVA_HOME/bin:$PATH"
cd apps/harmony
if [ ! -f build-profile.json5 ]; then
  cp build-profile.template.json5 build-profile.json5
fi
ohpm install
node "$DEVECO_DIR/tools/hvigor/bin/hvigorw.js" --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
