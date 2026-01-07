import StoreKit
import Combine
import FirebaseAuth
import FirebaseFirestore

@MainActor
final class SubscriptionStatus: ObservableObject {
	static let shared = SubscriptionStatus()
	
	@Published private(set) var isSubscribed = false
	@Published private(set) var isPremiumUser = false
	
	private let productIDs = AppProductID.allCases.map { $0.rawValue }
	private let db = Firestore.firestore()
	private var cancellables = Set<AnyCancellable>()
	
	private init() {
		FeatureFlagsManager.shared.$currentUserRole
			.receive(on: DispatchQueue.main)
			.sink { [weak self] _ in
				self?.recomputePremium()
			}
			.store(in: &cancellables)
		
		Task { await listen() }
	}
	
	// ─────────── Public API ───────────
	func refresh() async {
		await evaluateCurrentEntitlements()
	}
	
	// ─────────── StoreKit listening ───────────
	private func listen() async {
		await evaluateCurrentEntitlements()
		for await result in StoreKit.Transaction.updates {
			await handle(result)
		}
	}
	
	private func handle(_ result: VerificationResult<StoreKit.Transaction>) async {
		await evaluateCurrentEntitlements()
	}
	
	private func evaluateCurrentEntitlements() async {
		var active = false
		var latestTransaction: StoreKit.Transaction?
		
		for await result in StoreKit.Transaction.currentEntitlements {
			guard case .verified(let txn) = result else { continue }
			guard productIDs.contains(txn.productID) else { continue }
			
			if latestTransaction == nil || txn.purchaseDate > (latestTransaction?.purchaseDate ?? .distantPast) {
				latestTransaction = txn
			}
			
			if isActiveTransaction(txn) {
				active = true
			}
		}
		
		isSubscribed = active
		await syncUserSubscription(from: latestTransaction, isActive: active)
		recomputePremium()
	}
	
	private func isActiveTransaction(_ txn: StoreKit.Transaction) -> Bool {
		guard productIDs.contains(txn.productID) else { return false }
		if let revocation = txn.revocationDate, revocation <= Date() { return false }
		if let exp = txn.expirationDate { return exp > Date() }
		return true
	}
	
	// ─────────── Premium gating ───────────
	private func recomputePremium() {
		let role = FeatureFlagsManager.shared.currentUserRole
		let rolePremium = (role == "admin")
		isPremiumUser = rolePremium || isSubscribed
	}
	
	// ─────────── Firestore mirror of subscription ───────────
	private func syncUserSubscription(from txn: StoreKit.Transaction?, isActive: Bool) async {
		guard let uid = Auth.auth().currentUser?.uid else { return }
		
		var subscriptionData: [String: Any] = [:]
		var entitlements: [String] = []
		
		if let txn = txn {
			let tier = txn.productID.contains(".pro.") ? "pro" : "plus"
			let period = txn.productID.contains(".annual") ? "annual" : "monthly"
			let expiration = txn.expirationDate.map { Timestamp(date: $0) } ?? Timestamp(date: Date())
			
			subscriptionData["tier"]       = tier
			subscriptionData["productId"]  = txn.productID
			subscriptionData["period"]     = period
			subscriptionData["status"]     = isActive ? "active" : "expired"
			subscriptionData["expiration"] = expiration
			subscriptionData["autoRenew"]  = txn.revocationDate == nil
			subscriptionData["origTxnId"]  = String(txn.originalID)
			subscriptionData["verifiedAt"] = Timestamp(date: Date())
			
			if isActive {
				entitlements = [tier]
			}
		} else {
			subscriptionData["status"] = isActive ? "active" : "expired"
			if !isActive {
				subscriptionData["expiration"] = Timestamp(date: Date())
			}
		}
		
		var update: [String: Any] = ["subscription": subscriptionData]
		update["entitlements"] = entitlements
		
		do {
			try await db.collection("users").document(uid).setData(update, merge: true)
		} catch {
			print("SubscriptionStatus Firestore sync error: \(error.localizedDescription)")
		}
	}
}
