import SwiftUI
import Combine

class VotingViewModel: ObservableObject {
    @Published var features: [Feature] = []
    @Published var isLoading = false
    @Published var voteCounts: [String: Int] = [:]
    @Published var userVotes: [String: Bool] = [:]

    private var cancellables = Set<AnyCancellable>()
    
    // Update to match your own service locator or dependency injection
    private let votingService = AppServicesLocator.shared.votingService
    private let userService = AppServicesLocator.shared.userService
    private let featureService = AppServicesLocator.shared.featureService

    func loadData() {
        isLoading = true
        features = []
        
        // Fetch only features where display == true
        featureService.getFeatures(display: true)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                self?.isLoading = false
                if case .failure = completion {
                    // Handle error
                }
            } receiveValue: { [weak self] features in
                self?.features = features
                self?.loadVoteCounts {
                    self?.sortFeaturesByVotes()
                }
                self?.loadUserVotes()
            }
            .store(in: &cancellables)
    }

    func loadVoteCounts(completion: @escaping () -> Void) {
        let group = DispatchGroup()
        for feature in features {
            group.enter()
            votingService.countVotesForFeature(featureId: feature.id ?? "")
                .receive(on: DispatchQueue.main)
                .sink { _ in group.leave() } receiveValue: { [weak self] count in
                    self?.voteCounts[feature.id ?? ""] = count
                }
                .store(in: &cancellables)
        }
        group.notify(queue: .main) {
            completion()
        }
    }

    func sortFeaturesByVotes() {
        features.sort { (voteCounts[$0.id ?? ""] ?? 0) > (voteCounts[$1.id ?? ""] ?? 0) }
    }

    func loadUserVotes() {
        guard let userId = userService.getUserId() else { return }
        for feature in features {
            votingService.hasUserVotedForFeature(featureId: feature.id ?? "")
                .receive(on: DispatchQueue.main)
                .sink { _ in } receiveValue: { [weak self] hasVoted in
                    self?.userVotes[feature.id ?? ""] = hasVoted
                }
                .store(in: &cancellables)
        }
    }

    func voteForFeature(featureId: String) {
        guard let userId = userService.getUserId() else { return }
        votingService.voteForFeature(featureId: featureId)
            .receive(on: DispatchQueue.main)
            .sink { _ in } receiveValue: { [weak self] in
                self?.loadVoteCounts {
                    self?.sortFeaturesByVotes()
                }
                self?.loadUserVotes()
            }
            .store(in: &cancellables)
    }

    func hasVoted(featureId: String) -> Bool {
        userVotes[featureId] ?? false
    }
    
    func requestFeature(title: String, description: String) {
        guard let userId = userService.getUserId() else { return }
        votingService.requestFeature(title: title, description: description)
            .sink(receiveCompletion: { completion in
                switch completion {
                case .finished:
                    print("Feature request submitted successfully")
                case .failure(let error):
                    print("Failed to submit feature request: \(error)")
                }
            }, receiveValue: { _ in })
            .store(in: &cancellables)
    }
}
