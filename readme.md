Run locally using act 

act -W .github/workflows/build.yaml \
    --container-architecture linux/amd64 \
    --secret-file .secrets \
    workflow_dispatch \
    --input program=transaction-example \
    --input network=devnet \
    --input deploy=true \
    --input upload_idl=true
    

## 📝 Todo List

### Program Verification
- [ ] Trigger verified build PDA upload
- [ ] Support and test squads Verify
- [ ] Support and test squads IDL
- [ ] Support and test squads Program deploy

### Action Improvements
- [ ] Separate IDL and Program buffer action
- [ ] Remove deprecated cache functions
- [ ] Remove node-version from anchor build
- [ ] Support matrix build for develop branch
- [ ] Skip anchor build when native program build

### Testing & Integration
- [ ] Add running tests
  - Research support for different test frameworks
- [ ] Add Codama support
- [ ] Add to solana helpers -> release