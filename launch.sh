#!/bin/bash
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")"
npm run dev
