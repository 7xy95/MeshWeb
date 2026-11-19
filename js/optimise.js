const crypto = require("node:crypto")

function optimiseDomain(domain) {
	return [
		domain[0],
		crypto.createPublicKey(domain[1]).export({format: "jwk"}).x,
		domain[2],
		domain[3],
		domain[4],
		Buffer.from(domain[5], "hex").toString("base64url")
	]
}
function revertDomain(domain) {
	return [
		domain[0],
		crypto.createPublicKey({
			key: {kty: "OKP", crv: "Ed25519", x: domain[1]},
			format: "jwk"
		}).export({format: "pem", type: "spki"}),
		domain[2],
		domain[3],
		domain[4],
		Buffer.from(domain[5], "base64url").toString("hex")
	]
}

module.exports = {
	optimiseDomain,
	revertDomain
}