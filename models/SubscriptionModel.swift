import FirebaseFirestore

struct Subscription: Codable {
    var tier: String?          // "plus" | "pro"
    var productId: String?     // "com.ponder.plus.monthly" etc.
    var period: String?        // "monthly" | "annual"
    var status: String?        // "active" | "grace" | "expired"
    var expiration: Timestamp?
    var autoRenew: Bool?
    var origTxnId: String?
    var verifiedAt: Timestamp?
}
