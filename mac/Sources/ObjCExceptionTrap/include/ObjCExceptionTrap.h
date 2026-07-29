#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs a block, converting an Objective-C `NSException` into an `NSError`.
///
/// Swift has no way to catch `NSException` — `do/catch` only sees Swift errors,
/// so an exception raised inside a Cocoa framework call unwinds straight past
/// Swift code and aborts the process. AVFoundation raises them as *precondition*
/// checks: `-[AVAudioNode installTapOnBus:bufferSize:format:block:]` raises
/// `com.apple.coreaudio.avfaudio` ("required condition is false:
/// format.sampleRate == inputHWFormat.sampleRate") when the tap format no longer
/// matches the live input hardware, which killed this app on every audio device
/// change (#61). A few lines of Objective-C are the only way to survive one.
///
/// Catching an exception from an arbitrary framework is not generally safe — the
/// framework may be left half-mutated. It is safe for the call wrapped here
/// because it raises *before* doing any work: the condition is validated at the
/// top of the call, so nothing has changed when the exception is thrown. Wrap
/// only calls known to behave that way, not framework calls in general.
@interface ObjCExceptionTrap : NSObject

/// Runs `block`. Returns `YES` if it completed, or `NO` having set `error` to a
/// description of the `NSException` it raised. Imported into Swift as a throwing
/// call, so callers write `try ObjCExceptionTrap.run { … }`.
///
/// The selector is `run:` so it survives Swift's import unchanged. `perform:`
/// would collide with `NSObject`'s own `perform(_:)`, and `runBlock:` imports as
/// `run(_:)` anyway — Swift strips a trailing noun that just restates the
/// argument type, and then marks the spelled-out name obsolete.
+ (BOOL)run:(void (NS_NOESCAPE ^)(void))block
      error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
