#!/bin/bash
# E2E テスト — 本番 DB を汚さない
set -euo pipefail

export CC_MEM_DB_PATH="/tmp/cc-mem-test-$$.db"
trap "rm -f $CC_MEM_DB_PATH $CC_MEM_DB_PATH-wal $CC_MEM_DB_PATH-shm" EXIT

echo "=== E2E Test (DB: $CC_MEM_DB_PATH) ==="

# 1. Save with filtering
echo '{"type":"user","message":{"content":"ReactのuseStateとは？"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"useStateはReactのHookで、関数コンポーネントに状態管理を追加します。const [state, setState] = useState(initialValue) の形で使います。再レンダリング時にも状態は保持されます。"}]}}
{"type":"user","message":{"content":"読んで"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"はい"}]}}
{"type":"user","message":{"content":"ありがとう"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"どういたしまして！他に質問があればどうぞ。"}]}}' | bun run index.ts save 2>&1

echo ""

# 2. Dedup test
echo '{"type":"user","message":{"content":"ReactのuseStateとは？"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"useStateはReactのHookで、関数コンポーネントに状態管理を追加します。const [state, setState] = useState(initialValue) の形で使います。再レンダリング時にも状態は保持されます。"}]}}' | bun run index.ts save 2>&1

echo ""

# 3. Search
bun run index.ts search "React Hook" 2>&1

echo ""

# 4. Stats
bun run index.ts stats 2>&1

echo ""
echo "=== E2E Test Complete ==="
