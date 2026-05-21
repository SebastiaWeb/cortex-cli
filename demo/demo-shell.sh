#!/bin/bash
export PATH="/home/sebastiadev/Escritorio/cortex-cli/demo:/home/sebastiadev/.local/bin:/home/sebastiadev/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin"
alias cortex=cortex-mock
exec bash --norc "$@"
