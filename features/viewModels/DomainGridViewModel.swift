import SwiftUI
import Combine
import FirebaseFirestore

final class DomainGridViewModel: ObservableObject {
	@Published var domains: [Domain] = []
	@Published var isLoading: Bool = false
	@Published var error: String?
	
	private let db = Firestore.firestore()
	
	init() {
		fetchDomains()
	}
	
	// ─────────── Domains fetch ───────────
	func fetchDomains() {
		isLoading = true
		error = nil
		
		db.collection("domains").getDocuments { [weak self] snapshot, error in
			DispatchQueue.main.async {
				guard let self = self else { return }
				
				self.isLoading = false
				
				if let error = error {
					self.error = error.localizedDescription
					return
				}
				
				let docs = snapshot?.documents ?? []
				
				let loaded: [Domain] = docs.compactMap { doc in
					let data = doc.data()
					
					guard let name = data["name"] as? String else { return nil }
					
					let display       = data["display"] as? Bool ?? true
					let categoryLabel = data["categoryLabel"] as? String ?? ""
					let imageUrl      = data["imageUrl"] as? String
					
					let rawCategories = data["categories"] as? [[String: Any]] ?? []
					let categories: [DomainCategory] = rawCategories.compactMap { cat in
						guard
							let id   = cat["id"] as? String,
							let name = cat["name"] as? String
						else {
							return nil
						}
						return DomainCategory(id: id, name: name)
					}
					
					return Domain(
						id: doc.documentID,
						name: name,
						display: display,
						categoryLabel: categoryLabel,
						categories: categories,
						imageUrl: imageUrl
					)
				}
				
				let displayed = loaded.filter { $0.display }
				
				self.domains = displayed.sorted { a, b in
					let aIsHome = (a.id.lowercased() == "home") || (a.name.lowercased() == "home") || (a.name.lowercased() == "for you")
					let bIsHome = (b.id.lowercased() == "home") || (b.name.lowercased() == "home") || (b.name.lowercased() == "for you")
					if aIsHome != bIsHome { return aIsHome }
					
					let aInt = Int(a.id) ?? Int.max
					let bInt = Int(b.id) ?? Int.max
					if aInt != bInt { return aInt < bInt }
					
					return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
				}
			}
		}
	}
}
