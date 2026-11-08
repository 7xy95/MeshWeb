const { ipcRenderer } = require("electron")
const crypto = require("node:crypto")

const WORKGROUP_SIZE = 256
const HASHES_PER_THREAD = 8 // Benchmark 1, 2, 4, 8, or 16
const RESULT_WORDS = 10
const MAX_ATTEMPTS = 50_000_000
const MAX_WORKGROUPS =
    Math.ceil(MAX_ATTEMPTS / (WORKGROUP_SIZE * HASHES_PER_THREAD))
const MAX_RESULT_BYTES =
    MAX_WORKGROUPS * RESULT_WORDS * 4

let gpuMinerState = null

const SHA256_INIT = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])

const SHA256_K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
])

function rotr32(value, shift) {
    return (value >>> shift) | (value << (32 - shift))
}

function sha256CompressState(hash, blockBytes, offset) {
    const w = new Uint32Array(64)

    for (let i = 0; i < 16; i++) {
        const j = offset + i * 4

        w[i] = (
            (blockBytes[j] << 24) |
            (blockBytes[j + 1] << 16) |
            (blockBytes[j + 2] << 8) |
            blockBytes[j + 3]
        ) >>> 0
    }

    for (let i = 16; i < 64; i++) {
        const s0 = (
            rotr32(w[i - 15], 7) ^
            rotr32(w[i - 15], 18) ^
            (w[i - 15] >>> 3)
        ) >>> 0

        const s1 = (
            rotr32(w[i - 2], 17) ^
            rotr32(w[i - 2], 19) ^
            (w[i - 2] >>> 10)
        ) >>> 0

        w[i] = (
            w[i - 16] +
            s0 +
            w[i - 7] +
            s1
        ) >>> 0
    }

    let a = hash[0]
    let b = hash[1]
    let c = hash[2]
    let d = hash[3]
    let e = hash[4]
    let f = hash[5]
    let g = hash[6]
    let h = hash[7]

    for (let i = 0; i < 64; i++) {
        const s1 = (
            rotr32(e, 6) ^
            rotr32(e, 11) ^
            rotr32(e, 25)
        ) >>> 0

        const ch = ((e & f) ^ ((~e) & g)) >>> 0

        const temp1 = (
            h +
            s1 +
            ch +
            SHA256_K[i] +
            w[i]
        ) >>> 0

        const s0 = (
            rotr32(a, 2) ^
            rotr32(a, 13) ^
            rotr32(a, 22)
        ) >>> 0

        const maj = (
            (a & b) ^
            (a & c) ^
            (b & c)
        ) >>> 0

        const temp2 = (s0 + maj) >>> 0

        h = g
        g = f
        f = e
        e = (d + temp1) >>> 0
        d = c
        c = b
        b = a
        a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
}

function precomputePrefix(prefix) {
    const prefixBytes = new TextEncoder().encode(prefix)
    const fullPrefixBlocks =
        Math.floor(prefixBytes.length / 64)
    const hash = new Uint32Array(SHA256_INIT)

    for (let i = 0; i < fullPrefixBlocks; i++) {
        sha256CompressState(
            hash,
            prefixBytes,
            i * 64
        )
    }

    const tailStart = fullPrefixBlocks * 64
    const tailLen = prefixBytes.length - tailStart

    if (tailLen > 63) {
        throw new Error("Invalid SHA-256 prefix tail")
    }

    const prefixTail = new Uint32Array(64)

    for (let i = 0; i < tailLen; i++) {
        prefixTail[i] = prefixBytes[tailStart + i]
    }

    return {
        prefixLen: prefixBytes.length,
        prefixTailLen: tailLen,
        initialHash: hash,
        prefixTail
    }
}

function precomputeFirstRoundState(initialHash, prefixTailWords, roundCount) {
    const state = Array.from(initialHash, value => value >>> 0)
    let [a, b, c, d, e, f, g, h] = state
    for (let round = 0; round < roundCount; round++) {
        const word = prefixTailWords[round] >>> 0
        const bigSigmaOne = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)
        const choose = g ^ (e & (f ^ g))
        const tempOne = (h + bigSigmaOne + choose + SHA256_K[round] + word) >>> 0
        const bigSigmaZero = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)
        const majority = (a & b) | (c & (a | b))
        const tempTwo = (bigSigmaZero + majority) >>> 0
        h = g; g = f; f = e; e = (d + tempOne) >>> 0
        d = c; c = b; b = a; a = (tempOne + tempTwo) >>> 0
    }
    const logicalState = [a, b, c, d, e, f, g, h]
    const physicalState = new Uint32Array(8)
    for (let position = 0; position < 8; position++) {
        // Round n refers to logical register i through physical register (i-n) mod 8.
        physicalState[(position - roundCount + 64) & 7] = logicalState[position]
    }
    return physicalState
}

function createMessageBlockCode(prefixTailLen, blockIndex) {
    const statements = []
    for (let digitIndex = 0; digitIndex < 20; digitIndex++) {
        const position = prefixTailLen + digitIndex
        if ((position >>> 6) !== blockIndex) continue
        const slot = (position & 63) >>> 2
        const shift = (3 - (position & 3)) * 8
        statements.push(`if (nonce.length > ${digitIndex}u) { words[${slot}] = words[${slot}] | (nonce.bytes[${digitIndex}] << ${shift}u); }`)
    }
    const base = blockIndex === 0 ? 'inputData.prefixTailWords' : 'array<u32, 16>()'
    const offset = blockIndex === 0 ? 'paddingOffset' : '(paddingOffset - 64u)'
    const paddingCondition = blockIndex === 0 ? 'paddingOffset < 64u' : 'paddingOffset >= 64u'
    const lengthCondition = blockIndex === 0 ? 'blockCount == 1u' : 'true'
    return `fn makeMessageBlock${blockIndex}(nonce: DecimalNonce, blockCount: u32) -> array<u32, 16> {
    var words = ${base};
    ${statements.join('\n    ')}
    let paddingOffset = ${prefixTailLen}u + nonce.length;
    if (${paddingCondition}) {
        let offset = ${offset};
        let slot = (offset & 63u) >> 2u;
        let shift = (3u - (offset & 3u)) * 8u;
        words[slot] = words[slot] | (0x80u << shift);
    }
    if (${lengthCondition}) {
        words[14] = 0u;
        words[15] = (inputData.prefixLen + nonce.length) * 8u;
    }
    return words;
}`
}

function hashWordsLess(a, aOffset, b, bOffset) {
    for (let i = 0; i < 8; i++) {
        const av = a[aOffset + i] >>> 0
        const bv = b[bOffset + i] >>> 0

        if (av < bv) return true
        if (av > bv) return false
    }

    return false
}

function hashWordsToHex(words, offset) {
    let hex = ""

    for (let i = 0; i < 8; i++) {
        hex += (words[offset + i] >>> 0)
            .toString(16)
            .padStart(8, "0")
    }

    return hex
}

function createCompressionRounds(startRound = 0) {
    let rounds = ""
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"]
    for (let round = startRound; round < 64; round++) {
        const slot = round & 15
        const word = `w[${slot}]`
        if (round >= 16) {
            rounds += `${word} = ${word} + ss0(w[${(round - 15) & 15}]) + w[${(round - 7) & 15}] + ss1(w[${(round - 2) & 15}]);\n`
        }
        // Rotate names instead of copying six state values each round.
        // The previous 'h' becomes next 'a', and previous 'd' becomes next 'e'.
        const register = offset => names[(offset - round + 64) & 7]
        const [a, b, c, d, e, f, g, h] = Array.from({length: 8}, (_, offset) => register(offset))
        rounds += `let temp1Round${round} = ${h} + bs1(${e}) + ch(${e}, ${f}, ${g}) + 0x${SHA256_K[round].toString(16).padStart(8, "0")}u + ${word};\n`
        rounds += `let temp2Round${round} = bs0(${a}) + maj(${a}, ${b}, ${c});\n`
        rounds += `${h} = temp1Round${round} + temp2Round${round}; ${d} = ${d} + temp1Round${round};\n`
    }
    return rounds
}

async function initGpuMiner() {
    if (gpuMinerState) {
        return gpuMinerState
    }

    if (!navigator.gpu) {
        throw new Error("WebGPU is not available")
    }

    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance"
    })

    if (!adapter) {
        throw new Error("No GPU adapter found")
    }

    const device = await adapter.requestDevice()

    const maxComputeWorkgroupsPerDimension =
        adapter.limits.maxComputeWorkgroupsPerDimension

    const bindGroupLayout =
        device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility:
                        GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {
                    binding: 1,
                    visibility:
                        GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "storage"
                    }
                }
            ]
        })

    const pipelineCache = new Map()
    function getPipeline(prefixTailLen) {
        if (pipelineCache.has(prefixTailLen)) return pipelineCache.get(prefixTailLen)
        const firstRounds = Math.floor(prefixTailLen / 4)
        const shaderCode = `
struct InputData {
    prefixLen: u32,
    prefixTailLen: u32,
    startNonceLow: u32,
    startNonceHigh: u32,
    attempts: u32,
    dispatchWidth: u32,
    groupCount: u32,
    _pad: u32,
    initialHash: array<u32, 8>,
    prefixTailWords: array<u32, 16>,
    startNonceDigits: array<u32, 20>,
    startNonceLength: u32,
    firstRoundState: array<u32, 8>,
};

struct DecimalNonce {
    length: u32,
    bytes: array<u32, 20>,
};

@group(0) @binding(0)
var<storage, read> inputData: InputData;

@group(0) @binding(1)
var<storage, read_write> results: array<u32>;

var<workgroup> localHashes: array<array<u32, 8>, 256>;
var<workgroup> localNonceLow: array<u32, 256>;
var<workgroup> localNonceHigh: array<u32, 256>;

const K: array<u32, 64> = array<u32, 64>(
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,
    0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,
    0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,
    0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,
    0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,
    0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664b,0xc24b8b70u,0xc76c51a3u,
    0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,
    0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,
    0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
);

fn rotr(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

fn ch(x: u32, y: u32, z: u32) -> u32 {
    return z ^ (x & (y ^ z));
}

fn maj(x: u32, y: u32, z: u32) -> u32 {
    return (x & y) | (z & (x | y));
}

fn bs0(x: u32) -> u32 {
    return rotr(x, 2u) ^
           rotr(x, 13u) ^
           rotr(x, 22u);
}

fn bs1(x: u32) -> u32 {
    return rotr(x, 6u) ^
           rotr(x, 11u) ^
           rotr(x, 25u);
}

fn ss0(x: u32) -> u32 {
    return rotr(x, 7u) ^
           rotr(x, 18u) ^
           (x >> 3u);
}

fn ss1(x: u32) -> u32 {
    return rotr(x, 17u) ^
           rotr(x, 19u) ^
           (x >> 10u);
}

fn addIndexToNonce(
    startLow: u32,
    startHigh: u32,
    index: u32
) -> vec2<u32> {
    let low = startLow + index;
    let carry = select(0u, 1u, low < startLow);

    return vec2<u32>(
        low,
        startHigh + carry
    );
}

// The CPU supplies the starting nonce as 20 ASCII digits (zero-padded).
// Each GPU invocation adds its index directly to those digits instead of
// converting a full uint64 to decimal via repeated 16-bit limb division.
fn decimalNonce(index: u32) -> DecimalNonce {
    var output: DecimalNonce;
    var digits = inputData.startNonceDigits;
    var carry = index;
    var position = 20u;
    var nonceLength = inputData.startNonceLength;

    loop {
        if (carry == 0u || position == 0u) {
            break;
        }

        position = position - 1u;
        let digitSum = digits[position] - 48u + (carry % 10u);
        digits[position] = 48u + (digitSum % 10u);
        carry = carry / 10u + digitSum / 10u;
        if (digits[position] != 48u) {
            nonceLength = max(nonceLength, 20u - position);
        }
    }

    output.length = nonceLength;
    for (var i = 0u; i < nonceLength; i = i + 1u) {
        output.bytes[i] = digits[20u - nonceLength + i];
    }
    return output;
}

// Increment an already-ASCII nonce; no binary-to-decimal conversion.
fn incrementDecimalNonce(nonce: ptr<function, DecimalNonce>) {
    var position = (*nonce).length;
    loop {
        if (position == 0u) {
            // An extra digit appears at 9 -> 10, 99 -> 100, etc.
            if ((*nonce).length < 20u) {
                for (var i = (*nonce).length; i > 0u; i = i - 1u) {
                    (*nonce).bytes[i] = (*nonce).bytes[i - 1u];
                }
                (*nonce).bytes[0] = 49u;
                (*nonce).length = (*nonce).length + 1u;
            }
            break;
        }
        position = position - 1u;
        if ((*nonce).bytes[position] != 57u) {
            (*nonce).bytes[position] = (*nonce).bytes[position] + 1u;
            break;
        }
        (*nonce).bytes[position] = 48u;
    }
}

// Specialize each prefix-tail layout at shader compilation time.
// Only the nonce-dependent bytes are written in each invocation.
${createMessageBlockCode(prefixTailLen, 0)}
${createMessageBlockCode(prefixTailLen, 1)}

// 16-word rolling message schedule, all 64 rounds statically unrolled.
// The indices and K constants are literals so the compiler can use direct
// register references rather than dynamic array accesses.
fn compress(hashPointer: ptr<function, array<u32, 8>>, inputWords: array<u32, 16>) {
    var w = inputWords;
    var a = (*hashPointer)[0];
    var b = (*hashPointer)[1];
    var c = (*hashPointer)[2];
    var d = (*hashPointer)[3];
    var e = (*hashPointer)[4];
    var f = (*hashPointer)[5];
    var g = (*hashPointer)[6];
    var h = (*hashPointer)[7];

    ${createCompressionRounds()}

    (*hashPointer)[0] = (*hashPointer)[0] + a;
    (*hashPointer)[1] = (*hashPointer)[1] + b;
    (*hashPointer)[2] = (*hashPointer)[2] + c;
    (*hashPointer)[3] = (*hashPointer)[3] + d;
    (*hashPointer)[4] = (*hashPointer)[4] + e;
    (*hashPointer)[5] = (*hashPointer)[5] + f;
    (*hashPointer)[6] = (*hashPointer)[6] + g;
    (*hashPointer)[7] = (*hashPointer)[7] + h;
}


// CPU precomputes rounds preceding the first nonce word.
// This avoids re-running fixed prefix rounds for every GPU hash.
fn compressFirst(hashPointer: ptr<function, array<u32, 8>>, inputWords: array<u32, 16>) {
    var w = inputWords;
    var a = inputData.firstRoundState[0];
    var b = inputData.firstRoundState[1];
    var c = inputData.firstRoundState[2];
    var d = inputData.firstRoundState[3];
    var e = inputData.firstRoundState[4];
    var f = inputData.firstRoundState[5];
    var g = inputData.firstRoundState[6];
    var h = inputData.firstRoundState[7];

    ${createCompressionRounds(Math.floor(prefixTailLen / 4))}

    (*hashPointer)[0] = (*hashPointer)[0] + a;
    (*hashPointer)[1] = (*hashPointer)[1] + b;
    (*hashPointer)[2] = (*hashPointer)[2] + c;
    (*hashPointer)[3] = (*hashPointer)[3] + d;
    (*hashPointer)[4] = (*hashPointer)[4] + e;
    (*hashPointer)[5] = (*hashPointer)[5] + f;
    (*hashPointer)[6] = (*hashPointer)[6] + g;
    (*hashPointer)[7] = (*hashPointer)[7] + h;
}

fn sha256Header(nonce: DecimalNonce) -> array<u32, 8> {
    var hash = inputData.initialHash;
    let remainingTotalLen = ${prefixTailLen}u + nonce.length;
    let blockCount = select(1u, 2u, remainingTotalLen > 55u);

    let block0 = makeMessageBlock0(nonce, blockCount);
    compressFirst(&hash, block0);

    if (blockCount == 2u) {
        let block1 = makeMessageBlock1(nonce, blockCount);
        compress(&hash, block1);
    }
    return hash;
}

fn hashLess(
    a: array<u32, 8>,
    b: array<u32, 8>
) -> bool {
    for (
        var i = 0u;
        i < 8u;
        i = i + 1u
    ) {
        if (a[i] < b[i]) {
            return true;
        }

        if (a[i] > b[i]) {
            return false;
        }
    }

    return false;
}

@compute @workgroup_size(256)
fn main(
    @builtin(local_invocation_id)
    localId3: vec3<u32>,

    @builtin(workgroup_id)
    workgroupId: vec3<u32>
) {
    let localId = localId3.x;

    let groupIndex =
        workgroupId.y *
        inputData.dispatchWidth +
        workgroupId.x;

    if (groupIndex >= inputData.groupCount) {
        return;
    }

    let index =
        (groupIndex * 256u + localId) * ${HASHES_PER_THREAD}u;

    var hash = array<u32, 8>(
        0xffffffffu,0xffffffffu,
        0xffffffffu,0xffffffffu,
        0xffffffffu,0xffffffffu,
        0xffffffffu,0xffffffffu
    );

    var nonceLow = 0xffffffffu;
    var nonceHigh = 0xffffffffu;

    if (index < inputData.attempts) {
        var nonceDigits = decimalNonce(index);
        var nonce = addIndexToNonce(
            inputData.startNonceLow,
            inputData.startNonceHigh,
            index
        );

        for (var i = 0u; i < ${HASHES_PER_THREAD}u; i = i + 1u) {
            if (index + i >= inputData.attempts) {
                break;
            }

            let candidateHash = sha256Header(nonceDigits);
            if (hashLess(candidateHash, hash)) {
                hash = candidateHash;
                nonceLow = nonce.x;
                nonceHigh = nonce.y;
            }

            if (i + 1u < ${HASHES_PER_THREAD}u) {
                incrementDecimalNonce(&nonceDigits);
                let nextLow = nonce.x + 1u;
                nonce.y = nonce.y + select(0u, 1u, nextLow == 0u);
                nonce.x = nextLow;
            }
        }
    }

    localHashes[localId] = hash;
    localNonceLow[localId] = nonceLow;
    localNonceHigh[localId] = nonceHigh;

    workgroupBarrier();

    var stride = 128u;

    loop {
        if (stride == 0u) {
            break;
        }

        if (localId < stride) {
            let otherHash =
                localHashes[localId + stride];

            if (
                hashLess(
                    otherHash,
                    localHashes[localId]
                )
            ) {
                localHashes[localId] =
                    otherHash;

                localNonceLow[localId] =
                    localNonceLow[
                        localId + stride
                    ];

                localNonceHigh[localId] =
                    localNonceHigh[
                        localId + stride
                    ];
            }
        }

        workgroupBarrier();
        stride = stride / 2u;
    }

    if (localId == 0u) {
        let base =
            groupIndex * 10u;

        results[base] =
            localNonceLow[0];

        results[base + 1u] =
            localNonceHigh[0];

        for (
            var i = 0u;
            i < 8u;
            i = i + 1u
        ) {
            results[
                base + 2u + i
            ] = localHashes[0][i];
        }
    }
}
`

    const shaderModule =
        device.createShaderModule({
            code: shaderCode
        })



    const pipeline =
        device.createComputePipeline({
            layout:
                device.createPipelineLayout({
                    bindGroupLayouts: [
                        bindGroupLayout
                    ]
                }),
            compute: {
                module: shaderModule,
                entryPoint: "main"
            }
        })
        pipelineCache.set(prefixTailLen, pipeline)
        return pipeline
    }

    const inputBufferSize =
        (8 + 8 + 16 + 20 + 1 + 8) * 4

    const inputBuffer =
        device.createBuffer({
            size: inputBufferSize,
            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST
        })

    const resultBuffer =
        device.createBuffer({
            size: MAX_RESULT_BYTES,
            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_SRC
        })

    const readBuffer =
        device.createBuffer({
            size: MAX_RESULT_BYTES,
            usage:
                GPUBufferUsage.MAP_READ |
                GPUBufferUsage.COPY_DST
        })

    const bindGroup =
        device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: inputBuffer
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: resultBuffer
                    }
                }
            ]
        })

    gpuMinerState = {
        device,
        getPipeline,
        inputBuffer,
        resultBuffer,
        readBuffer,
        bindGroup,
        maxComputeWorkgroupsPerDimension
    }

    return gpuMinerState
}

async function gpuMine(
    prefix,
    startNonceLow,
    startNonceHigh,
    attempts
) {
    const state = await initGpuMiner()

    if (
        attempts < 1 ||
        attempts > MAX_ATTEMPTS
    ) {
        throw new Error(
            `attempts must be between 1 and ${MAX_ATTEMPTS}`
        )
    }

    const prefixData =
        precomputePrefix(prefix)

    const workgroupsNeeded =
        Math.ceil(
            attempts / (WORKGROUP_SIZE * HASHES_PER_THREAD)
        )

    const workgroupsX =
        Math.min(
            workgroupsNeeded,
            state.maxComputeWorkgroupsPerDimension
        )

    const workgroupsY =
        Math.ceil(
            workgroupsNeeded /
            workgroupsX
        )

    if (
        workgroupsY >
        state.maxComputeWorkgroupsPerDimension
    ) {
        throw new Error(
            "GPU workgroup dimensions exceed device limits"
        )
    }

    const inputU32 =
        new Uint32Array(
            8 + 8 + 16 + 20 + 1 + 8
        )

    inputU32[0] =
        prefixData.prefixLen

    inputU32[1] =
        prefixData.prefixTailLen

    inputU32[2] =
        startNonceLow >>> 0

    inputU32[3] =
        startNonceHigh >>> 0

    inputU32[4] = attempts
    inputU32[5] = workgroupsX
    inputU32[6] = workgroupsNeeded
    inputU32[7] = 0

    inputU32.set(
        prefixData.initialHash,
        8
    )

    // Prepack prefix bytes into 16 big-endian SHA-256 words.
    // This replaces 64 per-byte shader lookups with 16 fixed words.
    for (let i = 0; i < prefixData.prefixTailLen; i++) {
        const wordIndex = i >>> 2
        const shift = (3 - (i & 3)) * 8
        inputU32[16 + wordIndex] |= prefixData.prefixTail[i] << shift
    }

    // Construct the batch's starting nonce as ASCII exactly once on the CPU.
    // The GPU adds each invocation index to these decimal digits.
    const startNonce =
        (BigInt(startNonceHigh >>> 0) << 32n) |
        BigInt(startNonceLow >>> 0)
    const startNonceText = startNonce.toString()
    const paddedNonceText = startNonceText.padStart(20, "0")

    for (let i = 0; i < 20; i++) {
        inputU32[32 + i] = paddedNonceText.charCodeAt(i)
    }
    inputU32[52] = startNonceText.length

    const prefixWords = inputU32.subarray(16, 32)
    const firstRounds = Math.floor(prefixData.prefixTailLen / 4)
    inputU32.set(
        precomputeFirstRoundState(prefixData.initialHash, prefixWords, firstRounds),
        53
    )
    const pipeline = state.getPipeline(prefixData.prefixTailLen)

    state.device.queue.writeBuffer(
        state.inputBuffer,
        0,
        inputU32
    )

    const resultBytes =
        workgroupsNeeded *
        RESULT_WORDS *
        4

    const encoder =
        state.device.createCommandEncoder()

    const pass =
        encoder.beginComputePass()

    pass.setPipeline(pipeline)
    pass.setBindGroup(0, state.bindGroup)

    pass.dispatchWorkgroups(
        workgroupsX,
        workgroupsY
    )

    pass.end()

    encoder.copyBufferToBuffer(
        state.resultBuffer,
        0,
        state.readBuffer,
        0,
        resultBytes
    )

    state.device.queue.submit([
        encoder.finish()
    ])

    await state.readBuffer.mapAsync(
        GPUMapMode.READ,
        0,
        resultBytes
    )

    const results =
        new Uint32Array(
            state.readBuffer
                .getMappedRange(
                    0,
                    resultBytes
                )
                .slice(0)
        )

    state.readBuffer.unmap()

    let bestGroup = 0

    for (
        let group = 1;
        group < workgroupsNeeded;
        group++
    ) {
        const bestHashOffset =
            bestGroup *
            RESULT_WORDS +
            2

        const groupHashOffset =
            group *
            RESULT_WORDS +
            2

        if (
            hashWordsLess(
                results,
                groupHashOffset,
                results,
                bestHashOffset
            )
        ) {
            bestGroup = group
        }
    }

    const base =
        bestGroup * RESULT_WORDS

    const nonceLow =
        results[base] >>> 0

    const nonceHigh =
        results[base + 1] >>> 0

    const nonce =
        (
            (BigInt(nonceHigh) << 32n) |
            BigInt(nonceLow)
        ).toString()

    const hash =
        hashWordsToHex(
            results,
            base + 2
        )

    const actualHash = crypto.createHash("sha256")
        .update(prefix + nonce)
        .digest("hex")
    if (hash !== actualHash) {
        throw new Error(`GPU SHA-256 mismatch: GPU=${hash}, CPU=${actualHash}, nonce=${nonce}`)
    }

    return {
        ok: true,
        nonce,
        hash,
        attempts
    }
}

ipcRenderer.on(
    "gpu:mine",
    async (event, job) => {
        try {
            const result =
                await gpuMine(
                    job.prefix,
                    job.startNonceLow,
                    job.startNonceHigh,
                    job.attempts
                )

            ipcRenderer.send(
                "gpu:result",
                {
                    id: job.id,
                    result
                }
            )
        }
        catch (error) {
            ipcRenderer.send(
                "gpu:result",
                {
                    id: job.id,
                    result: {
                        ok: false,
                        nonce: "0",
                        hash: null,
                        attempts: 0,
                        error: error.message
                    }
                }
            )
        }
    }
)
