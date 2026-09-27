const { ipcRenderer } = require("electron")

const WORKGROUP_SIZE = 1024
const HASHES_PER_THREAD = 1
const MAX_UINT64 = (1n << 64n) - 1n

const SHA256_INIT = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
])

const SHA256_K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,
    0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
    0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,
    0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,
    0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
    0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,
    0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,
    0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
    0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
])

let gpuState = null

let cachedPrefix = null
let cachedPrefixData = null

function rotr32(value, shift) {
    return (
        (value >>> shift) |
        (value << (32 - shift))
    ) >>> 0
}

function sha256CompressState(
    hash,
    blockBytes,
    offset
) {
    let w = new Uint32Array(64)

    for (let i = 0; i < 16; i++) {
        let j = offset + i * 4

        w[i] = (
            (blockBytes[j] << 24) |
            (blockBytes[j + 1] << 16) |
            (blockBytes[j + 2] << 8) |
            blockBytes[j + 3]
        ) >>> 0
    }

    for (let i = 16; i < 64; i++) {
        let x = w[i - 15]
        let y = w[i - 2]

        let s0 = (
            rotr32(x, 7) ^
            rotr32(x, 18) ^
            (x >>> 3)
        ) >>> 0

        let s1 = (
            rotr32(y, 17) ^
            rotr32(y, 19) ^
            (y >>> 10)
        ) >>> 0

        w[i] = (
            s1 +
            w[i - 7] +
            s0 +
            w[i - 16]
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
        let s1 = (
            rotr32(e, 6) ^
            rotr32(e, 11) ^
            rotr32(e, 25)
        ) >>> 0

        let ch = (
            (e & f) ^
            ((~e) & g)
        ) >>> 0

        let temp1 = (
            h +
            s1 +
            ch +
            SHA256_K[i] +
            w[i]
        ) >>> 0

        let s0 = (
            rotr32(a, 2) ^
            rotr32(a, 13) ^
            rotr32(a, 22)
        ) >>> 0

        let maj = (
            (a & b) ^
            (a & c) ^
            (b & c)
        ) >>> 0

        let temp2 =
            (s0 + maj) >>> 0

        h = g
        g = f
        f = e
        e = (d + temp1) >>> 0
        d = c
        c = b
        b = a
        a = (temp1 + temp2) >>> 0
    }

    hash[0] =
        (hash[0] + a) >>> 0

    hash[1] =
        (hash[1] + b) >>> 0

    hash[2] =
        (hash[2] + c) >>> 0

    hash[3] =
        (hash[3] + d) >>> 0

    hash[4] =
        (hash[4] + e) >>> 0

    hash[5] =
        (hash[5] + f) >>> 0

    hash[6] =
        (hash[6] + g) >>> 0

    hash[7] =
        (hash[7] + h) >>> 0
}

function precomputePrefix(prefix) {
    if (
        prefix === cachedPrefix &&
        cachedPrefixData !== null
    ) {
        return cachedPrefixData
    }

    let prefixBytes =
        new TextEncoder().encode(prefix)

    let fullBlocks =
        Math.floor(
            prefixBytes.length / 64
        )

    let hash =
        new Uint32Array(
            SHA256_INIT
        )

    for (
        let i = 0;
        i < fullBlocks;
        i++
    ) {
        sha256CompressState(
            hash,
            prefixBytes,
            i * 64
        )
    }

    let tailStart =
        fullBlocks * 64

    let tailLen =
        prefixBytes.length -
        tailStart

    let tail =
        new Uint32Array(64)

    for (
        let i = 0;
        i < tailLen;
        i++
    ) {
        tail[i] =
            prefixBytes[
            tailStart + i
                ]
    }

    cachedPrefix = prefix

    cachedPrefixData = {
        prefixLen:
        prefixBytes.length,

        tailLen,
        hash,
        tail
    }

    return cachedPrefixData
}

async function initGpu() {
    if (gpuState) {
        return gpuState
    }

    if (!navigator.gpu) {
        throw new Error(
            "WebGPU is not available"
        )
    }

    let adapter =
        await navigator.gpu.requestAdapter({
            powerPreference:
                "high-performance"
        })

    if (!adapter) {
        throw new Error(
            "No GPU adapter found"
        )
    }

    let device =
        await adapter.requestDevice()

    const shader = `
struct InputData {
    prefixLen: u32,
    tailLen: u32,
    startLow: u32,
    startHigh: u32,

    attempts: u32,
    threadCount: u32,
    _pad0: u32,
    _pad1: u32,

    initialHash: array<u32, 8>,
    tail: array<u32, 64>,
};

struct Candidate {
    valid: u32,
    nonceLow: u32,
    nonceHigh: u32,
    _pad: u32,
    hash: array<u32, 8>,
};

struct ReductionData {
    count: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

struct DecimalNonce {
    len: u32,
    bytes: array<u32, 20>,
};

@group(0) @binding(0)
var<storage, read>
inputData: InputData;

@group(0) @binding(1)
var<storage, read_write>
stageOne: array<Candidate>;

@group(1) @binding(0)
var<storage, read>
reduceInput: array<Candidate>;

@group(1) @binding(1)
var<storage, read_write>
reduceOutput: array<Candidate>;

@group(1) @binding(2)
var<storage, read>
reductionData: ReductionData;

var<workgroup>
sharedCandidates:
    array<Candidate, ${WORKGROUP_SIZE}>;

const K: array<u32, 64> =
array<u32, 64>(
    0x428a2f98u,0x71374491u,
    0xb5c0fbcfu,0xe9b5dba5u,
    0x3956c25bu,0x59f111f1u,
    0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,
    0x243185beu,0x550c7dc3u,
    0x72be5d74u,0x80deb1feu,
    0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,
    0x0fc19dc6u,0x240ca1ccu,
    0x2de92c6fu,0x4a7484aau,
    0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,
    0xb00327c8u,0xbf597fc7u,
    0xc6e00bf3u,0xd5a79147u,
    0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,
    0x4d2c6dfcu,0x53380d13u,
    0x650a7354u,0x766a0abbu,
    0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,
    0xc24b8b70u,0xc76c51a3u,
    0xd192e819u,0xd6990624u,
    0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,
    0x2748774cu,0x34b0bcb5u,
    0x391c0cb3u,0x4ed8aa4au,
    0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,
    0x84c87814u,0x8cc70208u,
    0x90befffau,0xa4506cebu,
    0xbef9a3f7u,0xc67178f2u
);

fn rotr(
    x: u32,
    n: u32
) -> u32 {
    return
        (x >> n) |
        (x << (32u - n));
}

fn ch(
    x: u32,
    y: u32,
    z: u32
) -> u32 {
    return
        (x & y) ^
        ((~x) & z);
}

fn maj(
    x: u32,
    y: u32,
    z: u32
) -> u32 {
    return
        (x & y) ^
        (x & z) ^
        (y & z);
}

fn bs0(x: u32) -> u32 {
    return
        rotr(x, 2u) ^
        rotr(x, 13u) ^
        rotr(x, 22u);
}

fn bs1(x: u32) -> u32 {
    return
        rotr(x, 6u) ^
        rotr(x, 11u) ^
        rotr(x, 25u);
}

fn ss0(x: u32) -> u32 {
    return
        rotr(x, 7u) ^
        rotr(x, 18u) ^
        (x >> 3u);
}

fn ss1(x: u32) -> u32 {
    return
        rotr(x, 17u) ^
        rotr(x, 19u) ^
        (x >> 10u);
}

fn invalidCandidate()
    -> Candidate {

    var c: Candidate;

    c.valid = 0u;
    c.nonceLow = 0u;
    c.nonceHigh = 0u;
    c._pad = 0u;

    for (
        var i = 0u;
        i < 8u;
        i = i + 1u
    ) {
        c.hash[i] =
            0xffffffffu;
    }

    return c;
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

fn better(
    a: Candidate,
    b: Candidate
) -> Candidate {

    if (a.valid == 0u) {
        return b;
    }

    if (b.valid == 0u) {
        return a;
    }

    if (
        hashLess(
            a.hash,
            b.hash
        )
    ) {
        return a;
    }

    return b;
}

fn addOffset64(
    low: u32,
    high: u32,
    offset: u32
) -> vec2<u32> {

    let newLow =
        low + offset;

    let carry =
        select(
            0u,
            1u,
            newLow < low
        );

    return vec2<u32>(
        newLow,
        high + carry
    );
}

fn increment64(
    value: vec2<u32>
) -> vec2<u32> {

    let newLow =
        value.x + 1u;

    let carry =
        select(
            0u,
            1u,
            newLow == 0u
        );

    return vec2<u32>(
        newLow,
        value.y + carry
    );
}

fn toDecimal(
    low: u32,
    high: u32
) -> DecimalNonce {

    var out: DecimalNonce;

    out.len = 0u;

    for (
        var i = 0u;
        i < 20u;
        i = i + 1u
    ) {
        out.bytes[i] = 0u;
    }

    if (
        low == 0u &&
        high == 0u
    ) {
        out.len = 1u;
        out.bytes[0] = 48u;

        return out;
    }

    var limbs =
        array<u32, 4>(
            high >> 16u,
            high & 65535u,
            low >> 16u,
            low & 65535u
        );

    var reversed:
        array<u32, 20>;

    var len = 0u;

    loop {
        var carry = 0u;
        var nonZero = false;

        for (
            var i = 0u;
            i < 4u;
            i = i + 1u
        ) {
            let current =
                carry * 65536u +
                limbs[i];

            limbs[i] =
                current / 10u;

            carry =
                current % 10u;

            if (
                limbs[i] != 0u
            ) {
                nonZero = true;
            }
        }

        reversed[len] =
            48u + carry;

        len = len + 1u;

        if (!nonZero) {
            break;
        }
    }

    out.len = len;

    for (
        var i = 0u;
        i < len;
        i = i + 1u
    ) {
        out.bytes[i] =
            reversed[
                len - 1u - i
            ];
    }

    return out;
}

fn incrementDecimal(
    value:
        ptr<function, DecimalNonce>
) {
    var i =
        (*value).len;

    loop {
        if (i == 0u) {
            break;
        }

        i = i - 1u;

        if (
            (*value).bytes[i] <
            57u
        ) {
            (*value).bytes[i] =
                (*value).bytes[i] +
                1u;

            return;
        }

        (*value).bytes[i] =
            48u;
    }

    if (
        (*value).len <
        20u
    ) {
        var j =
            (*value).len;

        loop {
            if (j == 0u) {
                break;
            }

            (*value).bytes[j] =
                (*value).bytes[
                    j - 1u
                ];

            j = j - 1u;
        }

        (*value).bytes[0] =
            49u;

        (*value).len =
            (*value).len + 1u;
    }
}

fn compress(
    statePointer:
        ptr<
            function,
            array<u32, 8>
        >,

    wordsPointer:
        ptr<
            function,
            array<u32, 64>
        >
) {
    var w =
        *wordsPointer;

    for (
        var i = 16u;
        i < 64u;
        i = i + 1u
    ) {
        w[i] =
            ss1(w[i - 2u]) +
            w[i - 7u] +
            ss0(w[i - 15u]) +
            w[i - 16u];
    }

    var a =
        (*statePointer)[0];

    var b =
        (*statePointer)[1];

    var c =
        (*statePointer)[2];

    var d =
        (*statePointer)[3];

    var e =
        (*statePointer)[4];

    var f =
        (*statePointer)[5];

    var g =
        (*statePointer)[6];

    var h =
        (*statePointer)[7];

    for (
        var i = 0u;
        i < 64u;
        i = i + 1u
    ) {
        let t1 =
            h +
            bs1(e) +
            ch(e, f, g) +
            K[i] +
            w[i];

        let t2 =
            bs0(a) +
            maj(a, b, c);

        h = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }

    (*statePointer)[0] =
        (*statePointer)[0] +
        a;

    (*statePointer)[1] =
        (*statePointer)[1] +
        b;

    (*statePointer)[2] =
        (*statePointer)[2] +
        c;

    (*statePointer)[3] =
        (*statePointer)[3] +
        d;

    (*statePointer)[4] =
        (*statePointer)[4] +
        e;

    (*statePointer)[5] =
        (*statePointer)[5] +
        f;

    (*statePointer)[6] =
        (*statePointer)[6] +
        g;

    (*statePointer)[7] =
        (*statePointer)[7] +
        h;
}

fn remainingByte(
    index: u32,
    decimal: DecimalNonce,
    remainingLen: u32,
    paddedLen: u32,
    totalLen: u32
) -> u32 {

    if (
        index <
        remainingLen
    ) {
        if (
            index <
            inputData.tailLen
        ) {
            return
                inputData.tail[index] &
                255u;
        }

        return
            decimal.bytes[
                index -
                inputData.tailLen
            ];
    }

    if (
        index ==
        remainingLen
    ) {
        return 0x80u;
    }

    if (
        index >=
        paddedLen - 8u
    ) {
        let fromEnd =
            paddedLen -
            1u -
            index;

        if (
            fromEnd >= 4u
        ) {
            return 0u;
        }

        let bitLen =
            totalLen * 8u;

        return (
            bitLen >>
            (fromEnd * 8u)
        ) & 255u;
    }

    return 0u;
}

fn sha256DecimalNonce(
    decimal: DecimalNonce
) -> array<u32, 8> {

    var state =
        inputData.initialHash;

    let totalLen =
        inputData.prefixLen +
        decimal.len;

    let remainingLen =
        inputData.tailLen +
        decimal.len;

    let paddedLen =
        (
            remainingLen +
            9u +
            63u
        ) / 64u * 64u;

    let blockCount =
        paddedLen / 64u;

    for (
        var block = 0u;
        block < blockCount;
        block = block + 1u
    ) {
        var w:
            array<u32, 64>;

        for (
            var i = 0u;
            i < 16u;
            i = i + 1u
        ) {
            let base =
                block * 64u +
                i * 4u;

            let b0 =
                remainingByte(
                    base,
                    decimal,
                    remainingLen,
                    paddedLen,
                    totalLen
                );

            let b1 =
                remainingByte(
                    base + 1u,
                    decimal,
                    remainingLen,
                    paddedLen,
                    totalLen
                );

            let b2 =
                remainingByte(
                    base + 2u,
                    decimal,
                    remainingLen,
                    paddedLen,
                    totalLen
                );

            let b3 =
                remainingByte(
                    base + 3u,
                    decimal,
                    remainingLen,
                    paddedLen,
                    totalLen
                );

            w[i] =
                (b0 << 24u) |
                (b1 << 16u) |
                (b2 << 8u) |
                b3;
        }

        compress(
            &state,
            &w
        );
    }

    return state;
}

fn reduceShared(
    localIndex: u32
) {
    var stride =
        ${WORKGROUP_SIZE / 2}u;

    loop {
        if (
            localIndex <
            stride
        ) {
            sharedCandidates[
                localIndex
            ] =
                better(
                    sharedCandidates[
                        localIndex
                    ],

                    sharedCandidates[
                        localIndex +
                        stride
                    ]
                );
        }

        workgroupBarrier();

        if (
            stride == 1u
        ) {
            break;
        }

        stride =
            stride / 2u;
    }
}

@compute
@workgroup_size(${WORKGROUP_SIZE})
fn mineMain(
    @builtin(global_invocation_id)
    globalId: vec3<u32>,

    @builtin(local_invocation_id)
    localId: vec3<u32>,

    @builtin(workgroup_id)
    groupId: vec3<u32>
) {
    let threadIndex =
        globalId.x;

    var best =
        invalidCandidate();

    if (
        threadIndex <
        inputData.threadCount
    ) {
        let baseAttempt =
            threadIndex *
            ${HASHES_PER_THREAD}u;

        var nonce =
            addOffset64(
                inputData.startLow,
                inputData.startHigh,
                baseAttempt
            );

        var decimal =
            toDecimal(
                nonce.x,
                nonce.y
            );

        for (
            var j = 0u;
            j < ${HASHES_PER_THREAD}u;
            j = j + 1u
        ) {
            let attemptIndex =
                baseAttempt +
                j;

            if (
                attemptIndex >=
                inputData.attempts
            ) {
                break;
            }

            let hash =
                sha256DecimalNonce(
                    decimal
                );

            var candidate:
                Candidate;

            candidate.valid =
                1u;

            candidate.nonceLow =
                nonce.x;

            candidate.nonceHigh =
                nonce.y;

            candidate._pad =
                0u;

            candidate.hash =
                hash;

            best =
                better(
                    best,
                    candidate
                );

            if (
                j + 1u <
                ${HASHES_PER_THREAD}u
            ) {
                incrementDecimal(
                    &decimal
                );

                nonce =
                    increment64(
                        nonce
                    );
            }
        }
    }

    sharedCandidates[
        localId.x
    ] = best;

    workgroupBarrier();

    reduceShared(
        localId.x
    );

    if (
        localId.x == 0u
    ) {
        stageOne[
            groupId.x
        ] =
            sharedCandidates[0];
    }
}

@compute
@workgroup_size(${WORKGROUP_SIZE})
fn reduceMain(
    @builtin(global_invocation_id)
    globalId: vec3<u32>,

    @builtin(local_invocation_id)
    localId: vec3<u32>,

    @builtin(workgroup_id)
    groupId: vec3<u32>
) {
    let index =
        globalId.x;

    var value =
        invalidCandidate();

    if (
        index <
        reductionData.count
    ) {
        value =
            reduceInput[
                index
            ];
    }

    sharedCandidates[
        localId.x
    ] = value;

    workgroupBarrier();

    reduceShared(
        localId.x
    );

    if (
        localId.x == 0u
    ) {
        reduceOutput[
            groupId.x
        ] =
            sharedCandidates[0];
    }
}
`

    let shaderModule =
        device.createShaderModule({
            code: shader
        })

    let info =
        await shaderModule
            .getCompilationInfo()

    let errors =
        info.messages.filter(
            message =>
                message.type === "error"
        )

    if (
        errors.length > 0
    ) {
        throw new Error(
            errors
                .map(
                    error =>
                        `${error.lineNum}:${error.linePos} ${error.message}`
                )
                .join("\n")
        )
    }

    let mineBindGroupLayout =
        device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility:
                    GPUShaderStage.COMPUTE,

                    buffer: {
                        type:
                            "read-only-storage"
                    }
                },
                {
                    binding: 1,
                    visibility:
                    GPUShaderStage.COMPUTE,

                    buffer: {
                        type:
                            "storage"
                    }
                }
            ]
        })

    let reduceBindGroupLayout =
        device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility:
                    GPUShaderStage.COMPUTE,

                    buffer: {
                        type:
                            "read-only-storage"
                    }
                },
                {
                    binding: 1,
                    visibility:
                    GPUShaderStage.COMPUTE,

                    buffer: {
                        type:
                            "storage"
                    }
                },
                {
                    binding: 2,
                    visibility:
                    GPUShaderStage.COMPUTE,

                    buffer: {
                        type:
                            "read-only-storage"
                    }
                }
            ]
        })

    let minePipeline =
        device.createComputePipeline({
            layout:
                device.createPipelineLayout({
                    bindGroupLayouts: [
                        mineBindGroupLayout
                    ]
                }),

            compute: {
                module:
                shaderModule,

                entryPoint:
                    "mineMain"
            }
        })

    let reducePipeline =
        device.createComputePipeline({
            layout:
                device.createPipelineLayout({
                    bindGroupLayouts: [
                        reduceBindGroupLayout
                    ]
                }),

            compute: {
                module:
                shaderModule,

                entryPoint:
                    "reduceMain"
            }
        })

    let inputBuffer =
        device.createBuffer({
            size:
                (8 + 8 + 64) *
                4,

            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST
        })

    let maxThreadCount =
        Math.ceil(
            50_000_000 /
            HASHES_PER_THREAD
        )

    let maxStageOneCount =
        Math.ceil(
            maxThreadCount /
            WORKGROUP_SIZE
        )

    let candidateSize = 48

    let candidateBufferA =
        device.createBuffer({
            size:
                maxStageOneCount *
                candidateSize,

            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_SRC |
                GPUBufferUsage.COPY_DST
        })

    let candidateBufferB =
        device.createBuffer({
            size:
                maxStageOneCount *
                candidateSize,

            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_SRC |
                GPUBufferUsage.COPY_DST
        })

    let reductionBuffer =
        device.createBuffer({
            size: 16,

            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST
        })

    let readBuffer =
        device.createBuffer({
            size:
            candidateSize,

            usage:
                GPUBufferUsage.MAP_READ |
                GPUBufferUsage.COPY_DST
        })

    let mineBindGroup =
        device.createBindGroup({
            layout:
            mineBindGroupLayout,

            entries: [
                {
                    binding: 0,

                    resource: {
                        buffer:
                        inputBuffer
                    }
                },
                {
                    binding: 1,

                    resource: {
                        buffer:
                        candidateBufferA
                    }
                }
            ]
        })

    gpuState = {
        device,
        minePipeline,
        reducePipeline,
        reduceBindGroupLayout,
        inputBuffer,
        candidateBufferA,
        candidateBufferB,
        reductionBuffer,
        readBuffer,
        mineBindGroup,
        candidateSize
    }

    return gpuState
}

function makeReductionBindGroup(
    state,
    inputBuffer,
    outputBuffer
) {
    return state.device
        .createBindGroup({
            layout:
            state
                .reduceBindGroupLayout,

            entries: [
                {
                    binding: 0,

                    resource: {
                        buffer:
                        inputBuffer
                    }
                },
                {
                    binding: 1,

                    resource: {
                        buffer:
                        outputBuffer
                    }
                },
                {
                    binding: 2,

                    resource: {
                        buffer:
                        state
                            .reductionBuffer
                    }
                }
            ]
        })
}

function candidateHashHex(words) {
    let output = ""

    for (
        let i = 0;
        i < 8;
        i++
    ) {
        output +=
            words[i]
                .toString(16)
                .padStart(8, "0")
    }

    return output
}

async function mineBatch(
    prefix,
    startNonceText,
    requestedAttempts
) {
    let state =
        await initGpu()

    let startNonce =
        BigInt(
            startNonceText
        )

    if (
        startNonce < 0n ||
        startNonce >
        MAX_UINT64
    ) {
        throw new Error(
            "startNonce is outside uint64 range"
        )
    }

    let attempts =
        Math.max(
            1,
            Math.min(
                50_000_000,
                Math.floor(
                    requestedAttempts
                )
            )
        )

    let remaining =
        MAX_UINT64 -
        startNonce +
        1n

    if (
        remaining <
        BigInt(attempts)
    ) {
        attempts =
            Number(
                remaining
            )
    }

    let startLow =
        Number(
            startNonce &
            0xffffffffn
        )

    let startHigh =
        Number(
            (
                startNonce >>
                32n
            ) &
            0xffffffffn
        )

    let threadCount =
        Math.ceil(
            attempts /
            HASHES_PER_THREAD
        )

    let firstStageCount =
        Math.ceil(
            threadCount /
            WORKGROUP_SIZE
        )

    if (
        firstStageCount >
        state.device.limits
            .maxComputeWorkgroupsPerDimension
    ) {
        throw new Error(
            "Batch requires too many WebGPU workgroups"
        )
    }

    let prefixData =
        precomputePrefix(
            prefix
        )

    let input =
        new Uint32Array(
            8 + 8 + 64
        )

    input[0] =
        prefixData.prefixLen

    input[1] =
        prefixData.tailLen

    input[2] =
        startLow

    input[3] =
        startHigh

    input[4] =
        attempts

    input[5] =
        threadCount

    input[6] = 0
    input[7] = 0

    input.set(
        prefixData.hash,
        8
    )

    input.set(
        prefixData.tail,
        16
    )

    state.device.queue
        .writeBuffer(
            state.inputBuffer,
            0,
            input
        )

    {
        let encoder =
            state.device
                .createCommandEncoder()

        let pass =
            encoder
                .beginComputePass()

        pass.setPipeline(
            state.minePipeline
        )

        pass.setBindGroup(
            0,
            state.mineBindGroup
        )

        pass.dispatchWorkgroups(
            firstStageCount
        )

        pass.end()

        state.device.queue
            .submit([
                encoder.finish()
            ])
    }

    let count =
        firstStageCount

    let inputBuffer =
        state.candidateBufferA

    let outputBuffer =
        state.candidateBufferB

    while (
        count > 1
        ) {
        let outputCount =
            Math.ceil(
                count /
                WORKGROUP_SIZE
            )

        state.device.queue
            .writeBuffer(
                state.reductionBuffer,
                0,
                new Uint32Array([
                    count,
                    0,
                    0,
                    0
                ])
            )

        let bindGroup =
            makeReductionBindGroup(
                state,
                inputBuffer,
                outputBuffer
            )

        let encoder =
            state.device
                .createCommandEncoder()

        let pass =
            encoder
                .beginComputePass()

        pass.setPipeline(
            state.reducePipeline
        )

        pass.setBindGroup(
            0,
            bindGroup
        )

        pass.dispatchWorkgroups(
            outputCount
        )

        pass.end()

        state.device.queue
            .submit([
                encoder.finish()
            ])

        count =
            outputCount

        let temp =
            inputBuffer

        inputBuffer =
            outputBuffer

        outputBuffer =
            temp
    }

    {
        let encoder =
            state.device
                .createCommandEncoder()

        encoder.copyBufferToBuffer(
            inputBuffer,
            0,
            state.readBuffer,
            0,
            state.candidateSize
        )

        state.device.queue
            .submit([
                encoder.finish()
            ])
    }

    await state.readBuffer
        .mapAsync(
            GPUMapMode.READ
        )

    let result =
        new Uint32Array(
            state.readBuffer
                .getMappedRange()
                .slice(0)
        )

    state.readBuffer.unmap()

    if (
        result[0] !== 1
    ) {
        return {
            ok: false,
            error:
                "GPU batch produced no candidate"
        }
    }

    let nonceLow =
        BigInt(
            result[1]
        )

    let nonceHigh =
        BigInt(
            result[2]
        )

    let nonce =
        (
            (
                nonceHigh <<
                32n
            ) |
            nonceLow
        ).toString()

    let hashWords =
        result.slice(
            4,
            12
        )

    return {
        ok: true,
        nonce,

        hash:
            candidateHashHex(
                hashWords
            ),

        attempts
    }
}

ipcRenderer.on(
    "gpu:mine",
    async (
        event,
        job
    ) => {
        try {
            let result =
                await mineBatch(
                    job.prefix,
                    job.startNonce,
                    job.attempts
                )

            ipcRenderer.send(
                "gpu:result",
                {
                    id:
                    job.id,

                    result
                }
            )
        }
        catch (error) {
            ipcRenderer.send(
                "gpu:result",
                {
                    id:
                    job.id,

                    result: {
                        ok: false,

                        error:
                        error.message
                    }
                }
            )
        }
    }
)