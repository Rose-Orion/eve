#!/bin/bash
# Quick fal.ai test via curl — run on Mac Mini
# Usage: bash test-fal-simple.sh

set -e
source .env

if [ -z "$FAL_KEY" ]; then
  echo "❌ FAL_KEY not set"
  exit 1
fi

echo "Testing fal.ai API with key: ${FAL_KEY:0:8}..."
echo ""

# Test 1: Submit to queue
echo "--- Submitting to fal-ai/flux/schnell (fastest model) ---"
RESPONSE=$(curl -s -X POST "https://queue.fal.run/fal-ai/flux/schnell" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A red circle on white background","image_size":"square","num_images":1}')

echo "Response: $RESPONSE"

# Check for request_id (async queue mode)
REQUEST_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('request_id',''))" 2>/dev/null)

if [ -n "$REQUEST_ID" ]; then
  echo "Request ID: $REQUEST_ID"
  echo "Polling for result..."

  for i in {1..30}; do
    sleep 2
    STATUS=$(curl -s "https://queue.fal.run/fal-ai/flux/schnell/requests/$REQUEST_ID/status" \
      -H "Authorization: Key $FAL_KEY")
    echo "  Poll $i: $STATUS"

    COMPLETED=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('status')=='COMPLETED' else '')" 2>/dev/null)
    if [ "$COMPLETED" = "yes" ]; then
      RESULT=$(curl -s "https://queue.fal.run/fal-ai/flux/schnell/requests/$REQUEST_ID" \
        -H "Authorization: Key $FAL_KEY")
      echo "Result: $RESULT"

      # Extract URL
      URL=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('images',[{}])[0].get('url',''))" 2>/dev/null)
      if [ -n "$URL" ]; then
        echo "✅ Image URL: $URL"
        mkdir -p test-output
        curl -s -o test-output/test-flux-schnell.webp "$URL"
        echo "💾 Saved: test-output/test-flux-schnell.webp"
      fi
      break
    fi
  done
else
  # Might be a synchronous response with images directly
  URL=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('images',[{}])[0].get('url',''))" 2>/dev/null)
  if [ -n "$URL" ]; then
    echo "✅ Image URL: $URL"
    mkdir -p test-output
    curl -s -o test-output/test-flux-schnell.webp "$URL"
    echo "💾 Saved: test-output/test-flux-schnell.webp"
  else
    echo "❌ No images in response and no request_id"
  fi
fi

echo ""
echo "=== fal.ai test complete ==="
