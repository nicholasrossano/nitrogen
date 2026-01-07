import SwiftUI
import Combine

class FeedbackViewModel: NSObject, ObservableObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    @Published var title = ""
    @Published var feedbackDescription = ""
    @Published var image: UIImage?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var successMessage: String?

    private var cancellables = Set<AnyCancellable>()
    private let feedbackService = FeedbackService()

    func getImage(from source: UIImagePickerController.SourceType) {
        let picker = UIImagePickerController()
        picker.sourceType = source
        picker.allowsEditing = false
        picker.delegate = self
        
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first,
              let rootViewController = window.rootViewController else {
            print("Unable to present image picker: No valid window or root view controller")
            return
        }
        
        rootViewController.present(picker, animated: true, completion: nil)
    }

    func submitFeedback() {
        guard !title.isEmpty, !feedbackDescription.isEmpty else {
            errorMessage = "Please fill in all fields"
            return
        }

        isLoading = true
        errorMessage = nil

        if let image = image {
            feedbackService.uploadFile(image: image)
                .flatMap { [unowned self] imageUrl in
                    self.feedbackService.submitFeedback(title: self.title,
                                                        description: self.feedbackDescription,
                                                        imageUrl: imageUrl)
                }
                .receive(on: DispatchQueue.main)
                .sink(receiveCompletion: { completion in
                    self.isLoading = false
                    if case let .failure(error) = completion {
                        self.errorMessage = error.localizedDescription
                    }
                }, receiveValue: {
                    self.successMessage = "Feedback submitted successfully"
                    self.clearFields()
                })
                .store(in: &cancellables)
        } else {
            feedbackService.submitFeedback(title: title,
                                           description: feedbackDescription,
                                           imageUrl: nil)
                .receive(on: DispatchQueue.main)
                .sink(receiveCompletion: { completion in
                    self.isLoading = false
                    if case let .failure(error) = completion {
                        self.errorMessage = error.localizedDescription
                    }
                }, receiveValue: {
                    self.successMessage = "Feedback submitted successfully"
                    self.clearFields()
                })
                .store(in: &cancellables)
        }
    }

    private func clearFields() {
        title = ""
        feedbackDescription = ""
        image = nil
    }

    // MARK: - UIImagePickerControllerDelegate
    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
        if let pickedImage = info[.originalImage] as? UIImage {
            self.image = pickedImage
        }
        picker.dismiss(animated: true, completion: nil)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true, completion: nil)
    }
}
