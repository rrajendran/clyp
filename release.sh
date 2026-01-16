#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Validate input
if [ -z "$1" ]; then
    echo -e "${RED}Error: Version argument required${NC}"
    echo "Usage: ./release.sh <version>"
    echo "Examples:"
    echo "  ./release.sh 1.0.3"
    echo "  ./release.sh patch  (auto-increment patch)"
    echo "  ./release.sh minor  (auto-increment minor)"
    echo "  ./release.sh major  (auto-increment major)"
    exit 1
fi

release=$1

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Update version in package.json
echo -e "${GREEN}→ Updating version to ${release}${NC}"
npm version "$release" --no-git-tag-version

# Get the actual version (in case patch/minor/major was used)
new_version=$(node -p "require('./package.json').version")

# Commit the version change
echo -e "${GREEN}→ Committing version change${NC}"
git add package.json
git commit -m "Clyp Release - v${new_version}"

# Create tag (delete existing tag if present)
echo -e "${GREEN}→ Preparing tag v${new_version}${NC}"
if git rev-parse "v${new_version}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v${new_version} already exists locally.${NC}"
    read -p "Delete and recreate local tag v${new_version}? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "v${new_version}"
    else
        echo "Aborting to avoid overwriting existing local tag." && exit 1
    fi
fi

if git ls-remote --tags origin | grep -q "refs/tags/v${new_version}"; then
    echo -e "${YELLOW}Tag v${new_version} already exists on remote.${NC}"
    read -p "Delete remote tag v${new_version} and recreate? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push --delete origin "v${new_version}" || true
    else
        echo "Aborting to avoid overwriting existing remote tag." && exit 1
    fi
fi

# Create new tag
echo -e "${GREEN}→ Creating tag v${new_version}${NC}"
git tag "v${new_version}"

# Push commits and tag
echo -e "${GREEN}→ Pushing to origin${NC}"
git push origin main
git push origin "v${new_version}"

echo -e "${GREEN}✓ Release v${new_version} completed successfully!${NC}"
echo "GitHub Actions will now build and publish the release."
