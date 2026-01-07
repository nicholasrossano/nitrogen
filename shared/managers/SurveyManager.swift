// SurveyManager.swift
import SwiftUI
import Combine
import FirebaseAuth
import FirebaseFirestore

class SurveyManager {
    static let shared = SurveyManager()
    private let swipedExpandedKey = "swipedExpandedInExpandedModeCount"
    private var cancellables = Set<AnyCancellable>()

    /// Call this when a user swipes while in expanded mode
    func incrementSwipedInExpandedModeCount() {
        let c = UserDefaults.standard.integer(forKey: swipedExpandedKey)
        UserDefaults.standard.set(c + 1, forKey: swipedExpandedKey)
    }

    private func resetSwipedCount() {
        UserDefaults.standard.set(0, forKey: swipedExpandedKey)
    }

    private var swipedCount: Int {
        UserDefaults.standard.integer(forKey: swipedExpandedKey)
    }

    /// Checks each gate, logs progress, and presents survey when eligible
    func requestSurveyIfEligible(present: @escaping () -> Void) {
        guard let currentUser = AppServicesLocator.shared.userService.user else {
            print("[Survey] no user loaded")
            return
        }
        print("[Survey] surveyPromptShown:", currentUser.surveyPromptShown)
        guard !currentUser.surveyPromptShown else {
            print("[Survey] already shown → resetting counter")
            resetSwipedCount()
            return
        }

        if let creation = Auth.auth().currentUser?.metadata.creationDate {
            let age = Date().timeIntervalSince(creation)
            print("[Survey] account age secs:", age)
            guard age >= 1 * 24 * 3600 else {
                print("[Survey] too young → resetting counter")
                resetSwipedCount()
                return
            }
        }

        let count = swipedCount
        print("[Survey] swipedInExpandedModeCount:", count)
        guard count >= 3 else {
            print("[Survey] not enough swipes → resetting counter")
            resetSwipedCount()
            return
        }

        print("[Survey] 🌟 eligible! presenting survey")
        present()
        resetSwipedCount()
    }

    /// Write survey, log action, update user flag
    func handleSubmit(responses: [String: Any]) {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        let db = Firestore.firestore()

        db.collection("userSurveys").addDocument(data: [
            "userId": uid,
            "timestamp": Timestamp(date: Date()),
            "responses": responses
        ])

        db.collection("userActions").addDocument(data: [
            "userId": uid,
            "actionType": "surveySubmitted",
            "timestamp": Timestamp(date: Date())
        ])

        AppServicesLocator.shared.userService
            .updateSurveyShownFlag()
            .sink(receiveCompletion: { _ in }, receiveValue: { })
            .store(in: &cancellables)
    }
}
