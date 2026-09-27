const crypto = require("node:crypto")

const MIN_DIFFICULTY = 31

function sha256(data) {
    return BigInt("0x" + crypto.createHash("sha256").update(data).digest().toString("hex"))
}

function validDomain(value) {
    return /^[A-Za-z0-9.-]+$/.test(value) && !value.includes("..")
}

function verifyDomain(domain, alreadyRegistered, registrationIndex=null) {
    try {
        if (!validDomain(domain[0])) {return false}
        if (domain.length !== 6) {return false}
        if (domain[0].length > 64 || domain[3].length > 192) {return false}
        if (!domain[0].endsWith(".mesh")) {return false}

        let hash = sha256(domain[0] + domain[1] + domain[2])
        let target = 1n << BigInt(256 - MIN_DIFFICULTY)

        if (hash >= target) return false
        if (alreadyRegistered) {
            let otherDomain = global.domains[registrationIndex]

            if (otherDomain[1] !== domain[1]) {
                let otherHash = sha256(otherDomain[0] + otherDomain[1] + otherDomain[2])
                if (otherHash <= hash) {return false}
            }
            if (BigInt(domain[4]) > BigInt(otherDomain[4])+1024n || BigInt(domain[4]) <= BigInt(otherDomain[4])) {return false}
        }
        else if (domain[4] !== "0") {return false}

        let data = domain[0] +"|"+ domain[3] +"|"+ domain[4]

        return crypto.verify(
            null,
            Buffer.from(data),
            domain[1],
            Buffer.from(domain[5], "hex")
        )
    }
    catch (error) {
        console.log(error)
        return false
    }
}

module.exports = {
    verifyDomain,
    sha256
}