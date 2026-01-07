import FirebaseAuth
import FirebaseFirestore
import Combine

class UserService: ObservableObject {
	private let auth = Auth.auth()
	private let db = Firestore.firestore()
	
	@Published var user: User?
	private var cancellables = Set<AnyCancellable>()
	private var authStateListenerHandle: AuthStateDidChangeListenerHandle?
	
	private let cachedUserKey = "cached_user_json_v1"
	private let cachedUserUidKey = "cached_user_uid_v1"
	private let cachedUserSavedAtKey = "cached_user_saved_at_unix_v1"
	
	init() {
		loadCachedUserIfAvailable()
		
		authStateListenerHandle = auth.addStateDidChangeListener { [weak self] _, firebaseUser in
			guard let self = self else { return }
			
			if let firebaseUser = firebaseUser {
				self.fetchUserDetails(userId: firebaseUser.uid)
					.receive(on: DispatchQueue.main)
					.sink(receiveCompletion: { completion in
						if case .failure(let error) = completion {
							print("Failed to fetch user details: \(error)")
						}
					}, receiveValue: { user in
						self.user = user
						self.persistCachedUser(user: user)
					})
					.store(in: &self.cancellables)
			} else {
				self.user = nil
				self.clearCachedUser()
			}
		}
	}
	
	deinit {
		if let handle = authStateListenerHandle {
			auth.removeStateDidChangeListener(handle)
		}
	}
	
	func getUserId() -> String? {
		auth.currentUser?.uid
	}
	
	func refreshCurrentUser() {
		guard let uid = auth.currentUser?.uid else { return }
		fetchUserDetails(userId: uid)
			.receive(on: DispatchQueue.main)
			.sink(receiveCompletion: { _ in }, receiveValue: { [weak self] user in
				guard let self else { return }
				self.user = user
				self.persistCachedUser(user: user)
			})
			.store(in: &cancellables)
	}
	
	func fetchUserDetails(userId: String) -> AnyPublisher<User, Error> {
		Future { promise in
			self.db.collection("users").document(userId).getDocument { document, error in
				if let document = document, document.exists {
					let user = User(from: document)
					promise(.success(user))
				} else {
					promise(.failure(error ?? NSError(domain: "Document does not exist", code: 0)))
				}
			}
		}
		.eraseToAnyPublisher()
	}
	
	func updateUserDetails(user: User) -> AnyPublisher<Void, Error> {
		Future { promise in
			self.db.collection("users").document(user.id)
				.setData(user.toJson(), merge: true) { error in
					if let error = error {
						promise(.failure(error))
					} else {
						DispatchQueue.main.async {
							self.user = user
							self.persistCachedUser(user: user)
						}
						promise(.success(()))
					}
				}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Domain Preferences ───────────
	// IMPORTANT: Must replace the entire domainPreferences map so removed keys actually get deleted.
	func updateDomainPreferences(_ prefs: [String: [String]], completion: ((Bool, String?) -> Void)? = nil) {
		let userId: String
		let didHaveLoadedUser: Bool
		var updatedUser: User? = nil
		
		if var current = user {
			current.domainPreferences = prefs
			updatedUser = current
			userId = current.id
			didHaveLoadedUser = true
		} else if let uid = auth.currentUser?.uid, !uid.isEmpty {
			userId = uid
			didHaveLoadedUser = false
		} else {
			completion?(false, "no_user_loaded")
			return
		}
		
		if let updatedUser {
			DispatchQueue.main.async {
				self.user = updatedUser
				self.persistCachedUser(user: updatedUser)
			}
		}
		
		db.collection("users")
			.document(userId)
			.updateData(["domainPreferences": prefs]) { error in
				if let error = error {
					let ns = error as NSError
					
					if ns.domain == FirestoreErrorDomain,
					   ns.code == FirestoreErrorCode.notFound.rawValue {
						self.db.collection("users")
							.document(userId)
							.setData(["domainPreferences": prefs], merge: true) { err2 in
								if let err2 = err2 {
									print("Failed to create user doc with domainPreferences:", err2.localizedDescription)
									completion?(false, err2.localizedDescription)
								} else {
									if !didHaveLoadedUser {
										DispatchQueue.main.async {
											self.refreshCurrentUser()
										}
									}
									completion?(true, nil)
								}
							}
						return
					}
					
					print("Failed to update domainPreferences:", ns.localizedDescription)
					completion?(false, ns.localizedDescription)
					return
				}
				
				if !didHaveLoadedUser {
					DispatchQueue.main.async {
						self.refreshCurrentUser()
					}
				}
				
				completion?(true, nil)
			}
	}
	
	func updateSurveyShownFlag() -> AnyPublisher<Void, Error> {
		guard var current = user else {
			return Fail(error: NSError(domain: "No user loaded", code: 0)).eraseToAnyPublisher()
		}
		current.surveyPromptShown = true
		return updateUserDetails(user: current)
	}
	
	func getUserEmail() -> AnyPublisher<String, Error> {
		Future { promise in
			if let email = self.auth.currentUser?.email {
				promise(.success(email))
			} else {
				promise(.failure(NSError(domain: "No email found", code: 0)))
			}
		}
		.eraseToAnyPublisher()
	}
	
	func logout() -> AnyPublisher<Void, Error> {
		Future { promise in
			do {
				try self.auth.signOut()
				self.user = nil
				self.clearCachedUser()
				promise(.success(()))
			} catch {
				promise(.failure(error))
			}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Cache helpers ───────────
	private func loadCachedUserIfAvailable() {
		guard let uid = auth.currentUser?.uid else { return }
		let cachedUid = UserDefaults.standard.string(forKey: cachedUserUidKey) ?? ""
		guard cachedUid == uid else { return }
		guard let data = UserDefaults.standard.data(forKey: cachedUserKey) else { return }
		
		if let decoded = try? JSONDecoder().decode(User.self, from: data) {
			self.user = decoded
		}
	}
	
	private func persistCachedUser(user: User) {
		guard let data = try? JSONEncoder().encode(user) else { return }
		UserDefaults.standard.set(data, forKey: cachedUserKey)
		UserDefaults.standard.set(user.id, forKey: cachedUserUidKey)
		UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: cachedUserSavedAtKey)
	}
	
	private func clearCachedUser() {
		UserDefaults.standard.removeObject(forKey: cachedUserKey)
		UserDefaults.standard.removeObject(forKey: cachedUserUidKey)
		UserDefaults.standard.removeObject(forKey: cachedUserSavedAtKey)
	}
}
