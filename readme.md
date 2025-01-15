Run locally using act

act -W .github/workflows/build.yaml \
 --container-architecture linux/amd64 \
 --secret-file .secrets \
 workflow_dispatch \
 --input program=transaction-example \
 --input network=devnet \
 --input deploy=true \
 --input upload_idl=true

# Run tests only

act -W .github/workflows/test.yaml \
 --container-architecture linux/amd64 \
 --secret-file .secrets \
 workflow_dispatch \
 --input program=transaction-example

## 📝 Todo List

### Program Verification

- [x] Trigger verified build PDA upload
- [x] Verify build remote trigger
- [ ] Support and test squads Verify
- [ ] Support and test squads IDL
- [ ] Support and test squads Program deploy

### Action Improvements

- [x] Separate IDL and Program buffer action
- [ ] Remove deprecated cache functions
- [x] Remove node-version from anchor build
- [ ] Support matrix build for develop branch
- [ ] Skip anchor build when native program build
- [ ] Make verify build and anchor build in parallel
- [x] Trigger release build on tag push
- [ ] Trigger devnet releases on develop branch?

### Testing & Integration

- [ ] Add running tests
  - Research support for different test frameworks
- [ ] Add Codama support
- [ ] Add to solana helpers -> release
