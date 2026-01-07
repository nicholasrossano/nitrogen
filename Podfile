platform :ios, '17.0'

# Inhibit all pod warnings globally
inhibit_all_warnings!

post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      # Enforce the iOS 17 deployment target
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'

      # Clean up duplicate linker flags (like '-lc++')
      if config.build_settings['OTHER_LDFLAGS']
        flags = config.build_settings['OTHER_LDFLAGS'].split(' ')
        config.build_settings['OTHER_LDFLAGS'] = flags.uniq.join(' ')
      end
    end
  end

  # Give real output paths to avoid repeated 'Create Symlinks' warnings
  installer.pods_project.targets.each do |target|
    target.shell_script_build_phases.each do |phase|
      if phase.name == '[CP] Create Symlinks to Header Folders'
        phase.output_paths = ['$(DERIVED_FILE_DIR)/symlink_placeholder.txt']
      end
    end
  end
end

target 'Foreword' do
  use_frameworks!

  pod 'Firebase/Core'
  pod 'Firebase/Analytics'
  pod 'FirebaseCrashlytics'
  pod 'Firebase/Performance'
  pod 'Firebase/Auth'
  pod 'Firebase/Firestore'
  pod 'Firebase/Storage'
  pod 'Firebase/Functions'
  pod 'Firebase/RemoteConfig'
  pod 'Firebase/Messaging'
  pod 'SDWebImageSwiftUI'
  pod 'KeychainAccess'
  pod 'SwiftUICardStack'
  pod 'FBSDKCoreKit', '~> 18.0'
end