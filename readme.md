Run locally using act 

act -W .github/workflows/build.yaml \
    --container-architecture linux/amd64 \
    --secret-file .secrets \
    workflow_dispatch \
    --input program=transaction-example \
    --input network=devnet \
    --input deploy=true \
    --input upload_idl=true
    

Todo: 
[] Trigger verified build PDA upload 
[] Support and test squads Verify 
[] Support and test squads IDL
[] Support and test squads Program deploy 
[] Seperate IDL and Program buffer action 
[] Remove deprecated cache functions 
[] remove node-version from anchor build 
[] Support matrix build for develop branch 
[] Skip anchor build when native program build 
[] Codama support 
[] Add running tests (How to support different test frameworks?)
[] Add to solana helpers -> release 