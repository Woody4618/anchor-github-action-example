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

//   const verificationIxs = await parseVerificationTransaction(
//     "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAQGIiNQmHKbDYpSrbduAJeHBzlyqpzQqSOFXG5uY2Hlc5o8Grr2/oVqTc8D1TcQIqwos5xVz1CFLp9y2bsZhnn2JAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAANvpaSWr6/19VnDR/bQWdWwbFGmK/lqYwAmSmFVTSSF57z5h+SDuH6/PVwTetu6/b7rct7fJFBVl93NIVvq4/LAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAwAJA6CGAQAAAAAABAQBAAUCqAGvr20fDZib7QUAAAAwLjQuMDIAAABodHRwczovL2dpdGh1Yi5jb20vV29vZHk0NjE4L3NvbGFuYS1naXRodWItYWN0aW9ucygAAAA4NmI0NjRlODM5YzFmNDU4OTZkZjM0MTkyYWEyM2E1ODQ5NmNkMGQ3AgAAAA4AAAAtLWxpYnJhcnktbmFtZRMAAAB0cmFuc2FjdGlvbl9leGFtcGxljIzAEgAAAAA="
//   );

//   verificationIxs.instructions[0];

  // Build transaction message with all instructions
  // NOTE: You first need to upgrade the IDL if you do it after it sais the program is not deployed ...
  const message = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [ /*verificationIxs.instructions[0],*/ idlUpgradeIx, programUpgradeIx],
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
    await connection.confirmTransaction(createVaultSignature);
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
    await connection.confirmTransaction(createVaultSignature);
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
