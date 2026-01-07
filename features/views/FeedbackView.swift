import SwiftUI
import PhotosUI

struct FeedbackView: View {
    @StateObject private var viewModel = FeedbackViewModel()
    @Environment(\.presentationMode) private var presentationMode
    @Environment(\.colorScheme) private var colorScheme

    @State private var dragOffset: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            InputField(
                text: $viewModel.title,
                hintText: "Name for issue or request",
                borderRadius: 10
            ) 

            InputField(
                text: $viewModel.feedbackDescription,
                hintText: "Describe the issue or feedback request with as much detail as possible.",
                maxLines: 4,
                borderRadius: 10
            )

            imagePickerView()

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .padding(.top, 10)
            }

            if let successMessage = viewModel.successMessage {
                Text(successMessage)
                    .foregroundColor(.green)
                    .padding(.top, 10)
            }

            if viewModel.isLoading {
                ProgressView()
                    .padding()
            }

            Button(action: viewModel.submitFeedback) {
                Text("Submit")
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentPrimary)
                    .foregroundColor(.white)
                    .cornerRadius(25)
            }
            .padding(.top, 10)
            .frame(width: 200)
            .centered()

            Spacer()
        }
        .padding()
        .background(Color(.systemBackground))
        .foregroundColor(.primary)
        .customNavigation(title: "Submit Feedback")
        .swipeBack()
    }

    @ViewBuilder
    private func imagePickerView() -> some View {
        if let image = viewModel.image {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .onTapGesture {
                    viewModel.getImage(from: .photoLibrary)
                }
        } else {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color(.separator), lineWidth: 2)
                .overlay(
                    VStack {
                        Image(systemName: "camera.fill")
                            .foregroundColor(Color.accentPrimary)
                            .font(.system(size: 25))
                    }
                )
                .onTapGesture {
                    viewModel.getImage(from: .photoLibrary)
                }
                .frame(width: 150, height: 40)
                .centered()
        }
    }
}

extension View {
    func centered() -> some View {
        HStack {
            Spacer()
            self
            Spacer()
        }
    }
}
