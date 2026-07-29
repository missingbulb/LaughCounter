#import "ObjCExceptionTrap.h"

@implementation ObjCExceptionTrap

+ (BOOL)runBlock:(void (NS_NOESCAPE ^)(void))block
           error:(NSError *_Nullable *_Nullable)error {
    @try {
        block();
        return YES;
    } @catch (NSException *exception) {
        if (error != NULL) {
            // The reason is the useful half ("required condition is false: …");
            // the name says which subsystem raised it. Carry both, plus the
            // exception's own userInfo, so the caller can log something actionable
            // instead of "something threw".
            NSMutableDictionary *info = [NSMutableDictionary dictionary];
            info[NSLocalizedDescriptionKey] =
                [NSString stringWithFormat:@"%@: %@", exception.name,
                                           exception.reason ?: @"(no reason given)"];
            if (exception.userInfo != nil) {
                info[@"ObjCExceptionUserInfo"] = exception.userInfo;
            }
            *error = [NSError errorWithDomain:@"LaughCounter.ObjCException"
                                         code:1
                                     userInfo:info];
        }
        return NO;
    }
}

@end
