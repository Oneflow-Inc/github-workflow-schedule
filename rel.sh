set -ex
ncc build index.js
git add .
git commit -m "rel"
echo $(git rev-parse HEAD)
