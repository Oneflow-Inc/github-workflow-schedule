set -ex
ncc build --minify index.js
git add .
git commit -m "rel"
echo $(git rev-parse HEAD)
git push
