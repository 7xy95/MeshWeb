const verify = require("./verify.js")

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
function newDomain(domain, maxSequenceGap=16n) {
    if (domain.length !== 6) {return false}
    let index = global.domains.findIndex(item => item[0] === domain[0])

    if (index !== -1) {
        let oDomain = global.domains[index]

        if (oDomain[1] === domain[1]) {
            if (
                BigInt(domain[4]) > BigInt(oDomain[4]) &&
                verify.verifyDomain(domain, true, index, maxSequenceGap)
            ) {
                global.domains[index] = domain
                return true
            }
        }
        else {
            if (verify.verifyDomain(domain, true, index, maxSequenceGap)) {
                global.domains[index] = domain
                return true
            }
        }
    }
    else {
        if (verify.verifyDomain(domain, false, maxSequenceGap)) {
            global.domains.push(domain)
            return true
        }
    }
    return false
}
function domainToEndpoint(domain) {
    try {
        let url = new URL(domain)

        let d = global.domains.find(item => item[0] === url.hostname)

        if (!domain) {return domain}
        let endpoint = new URL(d[3])

        endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + url.pathname

        endpoint.search = url.search
        endpoint.hash = url.hash

        return endpoint.href.replace("/?", "?")
    }
    catch {
        return domain
    }
}
function endpointToDomain(endpoint) {
    let index = global.domains.findIndex(item => endpoint.startsWith(item[3]))

    if (index === -1) {return endpoint}

    let domain = global.domains[index][0]
    let nEndpoint = global.domains[index][3]

    return (domain + endpoint.slice(nEndpoint.length)).replace("/?", "?")
}
function getDomainDifficulty(domain) {
    let d = global.domains.find(item => item[0] === domain)

    if (!d) {return 0}

    let hash = verify.sha256(d[0] + d[1] + d[2])

    return 256 - Math.log2(Number(hash))
}

global.newDomain = newDomain
global.sleep = sleep
global.domainToEndpoint = domainToEndpoint
global.endpointToDomain = endpointToDomain
global.getDomainDifficulty = getDomainDifficulty