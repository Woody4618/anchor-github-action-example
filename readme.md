act -W .github/workflows/build.yaml \
    --container-architecture linux/amd64 \
    --secret-file .secrets \
    workflow_dispatch \
    --input program=transaction-example \
    --input network=devnet \
    --input deploy=true \
    --input upload_idl=true
    