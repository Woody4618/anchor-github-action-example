import * as multisig from "@sqds/multisig";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  Keypair,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { idlAddress } from "@coral-xyz/anchor/dist/cjs/idl";
import * as yargs from "yargs";
import {
  prepareTransactionWithCompute,
  sendTransactionWithRetry,
  type TxStatusUpdate,
} from "./transaction-helpers";

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

async function parseVerificationTransaction(
  base64String: string
): Promise<Transaction> {
  // Decode base64 to buffer
  const buffer = Buffer.from(base64String, "base64");

  // Parse into versioned transaction
  return Transaction.from(buffer);
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
    })
    .option("pda-tx", {
      type: "string",
      description: "The base64 encoded verify pda transaction",
      required: false,
    }).argv;

  const connection = new Connection(argv.rpc);
  const keypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require("fs").readFileSync(argv.keypair, "utf-8")))
  );
  const multisigPda = new PublicKey(argv.multisig);
  const programId = new PublicKey(argv.program);
  const programBuffer = new PublicKey(argv.buffer);
  const idlBuffer = new PublicKey(argv["idl-buffer"]);
  const pdaTx = argv.pdaTx;

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
  console.log("Extracted PDA transaction:", pdaTx?.toString());

  // Create authority transfer instructions
  // NOTE: We cant use this because setting authority and upgrading program in the same transaction fails
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
  // NOTE: You first need to upgrade the IDL if you do it after it says the program is not deployed ...
  let instructions = [idlUpgradeIx, programUpgradeIx];

  if (argv.pdaTx) {
    const verificationTx = await parseVerificationTransaction(argv.pdaTx);
    if (verificationTx.instructions.length > 0) {
      console.log("Adding verification instruction");
      instructions = [verificationTx.instructions[1], ...instructions];
    }
  }

  const message = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions,
  });

  // Get next transaction index
  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );

  const currentTransactionIndex = Number(multisigInfo.transactionIndex);

  const newTransactionIndex = BigInt(currentTransactionIndex + 1);

  try {
    console.log("\n=== Creating Upgrade Transaction ===");

    // Create vault transaction instruction
    const createVaultTxIx = await multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator: keypair.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
      memo: "Program and IDL upgrade",
    });

    // Create transaction and add compute budget
    const tx = new Transaction();
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.add(createVaultTxIx);
    await prepareTransactionWithCompute(
      connection,
      tx,
      keypair.publicKey,
      100_000
    );

    // Send transaction
    const createVaultSignature = await sendTransactionWithRetry(
      connection,
      tx,
      [keypair],
      {
        commitment: "confirmed",
        skipPreflight: true,
        onStatusUpdate: (status: TxStatusUpdate) => {
          if (status.status === "confirmed") {
            console.log("Transaction confirmed:", status.result);
          }
        },
      }
    );

    const latestBlockHash = await connection.getLatestBlockhash();

    await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: createVaultSignature,
    });

    console.log("Transaction Created - Signature:", createVaultSignature);

    // Create proposal instruction
    console.log("\n=== Creating Proposal ===");
    const proposalIx = await multisig.instructions.proposalCreate({
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator: keypair.publicKey,
    });

    // Create and prepare proposal transaction
    const proposalTx = new Transaction();
    proposalTx.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    proposalTx.add(proposalIx);
    await prepareTransactionWithCompute(
      connection,
      proposalTx,
      keypair.publicKey,
      100_000
    );

    // Send proposal transaction
    const proposalSignature = await sendTransactionWithRetry(
      connection,
      proposalTx,
      [keypair],
      {
        commitment: "confirmed",
        skipPreflight: true,
        onStatusUpdate: (status: TxStatusUpdate) => {
          if (status.status === "confirmed") {
            console.log("Proposal confirmed:", status.result);
          }
        },
      }
    );

    console.log("Proposal Created - Signature:", proposalSignature);
    console.log("\nPlease approve in Squads UI: https://v4.squads.so/");
  } catch (error) {
    console.error("\n=== Error ===");
    console.error("Error details:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
