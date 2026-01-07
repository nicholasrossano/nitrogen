import Foundation
import Combine
import StoreKit

@MainActor
final class PremiumViewModel: ObservableObject {
	@Published var displayPrice: String?
	@Published var canPurchase = false
	@Published private(set) var isSubscribed = false {
		didSet { canPurchase = !isSubscribed }
	}
	
	var buttonTitle: String { isSubscribed ? "Manage Subscription" : "Subscribe to Foreword+" }
	
	private let monthlyID = AppProductID.plusMonthly.rawValue
	private let annualID  = AppProductID.plusAnnual.rawValue
	
	private var monthly: StoreKit.Product?
	private var annual: StoreKit.Product?
	
	private var cancellables = Set<AnyCancellable>()
	
	init() {
		isSubscribed = SubscriptionStatus.shared.isPremiumUser
		
		SubscriptionStatus.shared.$isPremiumUser
			.receive(on: DispatchQueue.main)
			.sink { [weak self] premium in
				self?.isSubscribed = premium
			}
			.store(in: &cancellables)
	}
	
	// ─────────── Product loading ───────────
	func loadProducts() async {
		let ids = [monthlyID, annualID]
		do {
			let storeProducts = try await StoreKit.Product.products(for: ids)
			monthly = storeProducts.first { $0.id == monthlyID }
			annual  = storeProducts.first { $0.id == annualID }
			
			if let p = monthly ?? annual {
				displayPrice = p.displayName + " – " + p.displayPrice
				canPurchase  = !isSubscribed
			}
			
			await SubscriptionStatus.shared.refresh()
		} catch {
			print("StoreKit product fetch failed: \(error)")
		}
	}
	
	// ─────────── Purchase ───────────
	func subscribe() async {
		guard !SubscriptionStatus.shared.isPremiumUser else { return }
		guard let product = monthly ?? annual else { return }
		do {
			let result = try await product.purchase()
			switch result {
			case .success(let verification):
				if case .verified(let txn) = verification {
					await handle(transaction: txn)
					await txn.finish()
					isSubscribed = true
				}
			case .userCancelled, .pending, .success(.unverified):
				break
			@unknown default:
				break
			}
		} catch {
			print("Purchase error: \(error)")
		}
	}
	
	private func handle(transaction txn: StoreKit.Transaction) async {
		await SubscriptionStatus.shared.refresh()
	}
}
