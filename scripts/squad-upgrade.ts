import * as multisig from "@sqds/multisig";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  Keypair,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { idlAddress } from "@coral-xyz/anchor/dist/cjs/idl";
import * as yargs from "yargs";

const BPF_UPGRADE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

async function createIdlUpgradeInstruction(
  programId: PublicKey,
  bufferAddress: PublicKey,
  upgradeAuthority: PublicKey
): Promise<TransactionInstruction> {
  const idlAddr = await idlAddress(programId);

  console.log("\n=== IDL Info ===");
  console.log("IDL Address:", idlAddr.toString());
  console.log("Buffer:", bufferAddress.toString());

  // Create instruction data: [40, f4, bc, 78, a7, e9, 69, 0a, 03]
  const data = Buffer.from([
    0x40, 0xf4, 0xbc, 0x78, 0xa7, 0xe9, 0x69, 0x0a, 0x03,
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: bufferAddress, isWritable: true, isSigner: false },
      { pubkey: idlAddr, isWritable: true, isSigner: false },
      { pubkey: upgradeAuthority, isWritable: true, isSigner: true },
    ],
    programId,
    data,
  });
}

async function createProgramUpgradeInstruction(
  programId: PublicKey,
  bufferAddress: PublicKey,
  upgradeAuthority: PublicKey,
  spillAddress: PublicKey
): Promise<TransactionInstruction> {
  const [programDataAddress] = await PublicKey.findProgramAddress(
    [programId.toBuffer()],
    BPF_UPGRADE_LOADER_ID
  );

  return new TransactionInstruction({
    keys: [
      { pubkey: programDataAddress, isWritable: true, isSigner: false },
      { pubkey: programId, isWritable: true, isSigner: false },
      { pubkey: bufferAddress, isWritable: true, isSigner: false },
      { pubkey: spillAddress, isWritable: true, isSigner: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
      { pubkey: upgradeAuthority, isWritable: false, isSigner: true },
    ],
    programId: BPF_UPGRADE_LOADER_ID,
    data: Buffer.from([3, 0, 0, 0]),
  });
}

async function confirmTransaction(
  connection: Connection,
  signature: string,
  maxAttempts = 3
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const latestBlockhash = await connection.getLatestBlockhash();
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      return confirmation;
    } catch (error) {
      // Check if transaction was actually confirmed despite timeout
      const status = await connection.getSignatureStatus(signature);
      if (status?.value?.confirmationStatus === "confirmed") {
        return status;
      }

      if (attempt < maxAttempts) {
        console.log(`Confirmation attempt ${attempt} failed, retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      throw error;
    }
  }
}

async function createSetBufferAuthorityInstruction(
  bufferAddress: PublicKey,
  currentAuthority: PublicKey,
  newAuthority: PublicKey
): Promise<TransactionInstruction> {
  return new TransactionInstruction({
    keys: [
      { pubkey: bufferAddress, isWritable: true, isSigner: false },
      { pubkey: currentAuthority, isWritable: false, isSigner: true },
      { pubkey: newAuthority, isWritable: false, isSigner: false },
    ],
    programId: BPF_UPGRADE_LOADER_ID,
    data: Buffer.from([4, 0, 0, 0]), // SetBufferAuthority instruction
  });
}

async function main() {
  const argv = await yargs
    .option("rpc", {
      type: "string",
      description: "RPC URL",
      required: true,
    })
    .option("program", {
      type: "string",
      description: "Program ID",
      required: true,
    })
    .option("buffer", {
      type: "string",
      description: "Program buffer address",
      required: true,
    })
    .option("idl-buffer", {
      type: "string",
      description: "IDL buffer address",
      required: true,
    })
    .option("multisig", {
      type: "string",
      description: "Multisig address",
      required: true,
    })
    .option("keypair", {
      type: "string",
      description: "Path to keypair file",
      required: true,
    }).argv;

  const connection = new Connection(argv.rpc);
  const keypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require("fs").readFileSync(argv.keypair, "utf-8")))
  );
  const multisigPda = new PublicKey(argv.multisig);
  const programId = new PublicKey(argv.program);
  const programBuffer = new PublicKey(argv.buffer);
  const idlBuffer = new PublicKey(argv["idl-buffer"]);

  // Get vault PDA (authority)
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0,
  });

  console.log("\n=== Setup Info ===");
  console.log("Multisig:", multisigPda.toString());
  console.log("Vault:", vaultPda.toString());
  console.log("Program:", programId.toString());
  console.log("Program Buffer:", programBuffer.toString());
  console.log("IDL Buffer:", idlBuffer.toString());

  // Create authority transfer instructions
  const programBufferAuthorityIx = await createSetBufferAuthorityInstruction(
    programBuffer,
    keypair.publicKey,
    vaultPda
  );

  // Create both upgrade instructions
  const programUpgradeIx = await createProgramUpgradeInstruction(
    programId,
    programBuffer,
    vaultPda,
    keypair.publicKey
  );

  const idlUpgradeIx = await createIdlUpgradeInstruction(
    programId,
    idlBuffer,
    vaultPda
  );

  // Build transaction message with all instructions
  const message = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [programBufferAuthorityIx, programUpgradeIx, idlUpgradeIx],
  });

  // Get next transaction index
  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );
  const newTransactionIndex = BigInt(Number(multisigInfo.transactionIndex) + 1);

  try {
    console.log("\n=== Creating Upgrade Transaction ===");
    const createVaultSignature = await multisig.rpc.vaultTransactionCreate({
      connection,
      feePayer: keypair,
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator: keypair.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
      memo: "Program and IDL upgrade",
    });

    console.log("Confirming transaction:", createVaultSignature);
    await confirmTransaction(connection, createVaultSignature);
    console.log("Transaction Created - Signature:", createVaultSignature);

    console.log("\n=== Creating Proposal ===");
    const proposalCreateSignature = await multisig.rpc.proposalCreate({
      connection,
      feePayer: keypair,
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator: keypair,
    });

    console.log("Confirming proposal:", proposalCreateSignature);
    await confirmTransaction(connection, proposalCreateSignature);
    console.log("Proposal Created - Signature:", proposalCreateSignature);
    console.log("\nPlease approve in Squads UI: https://v4.squads.so/");
  } catch (error) {
    console.error("\n=== Error ===");
    console.error("Error details:", error);
    process.exit(1); // Exit with error code to prevent double logging
  }
}

if (require.main === module) {
  main().catch(console.error);
}
