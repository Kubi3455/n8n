#!/bin/sh
# macOS: bu dosyaya çift tıklayarak uygulamayı başlatabilirsiniz.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js bulunamadı."
  echo "  https://nodejs.org adresinden LTS sürümünü kurun, sonra bu dosyayı tekrar çalıştırın."
  echo ""
  exit 1
fi

node server/index.js
