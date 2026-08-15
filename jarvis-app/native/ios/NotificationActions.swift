// NotificationActions.swift
// JARVIS native seven, item 4: actionable notifications.
//
// Staged uncompiled 2026-08-15. Registers one UNNotificationCategory for
// task notifications with two actions:
//   Done: completes the task from the banner, app stays closed.
//   Tomorrow: pushes the task a day using the SAME mechanics as Auto-Sweep
//     on the JS side: TasksService.setDue(id, tomorrow, slipped) advances
//     the slips counter and fires task.pushed, so the third-slip Set Aside
//     offer and the Brain's slip patterns see banner pushes exactly like
//     sweep moves. The native side never mutates task state itself; it
//     forwards {action, taskId} to the bridge and the web app owns the
//     write (one brain, every surface).
//
// TODO(signing): push notifications need the aps-environment entitlement
// after enrollment; local notifications with actions work without it.

import Foundation
import Capacitor
import UserNotifications

@objc(NotificationActionsPlugin)
public class NotificationActionsPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "NotificationActionsPlugin"
    public let jsName = "NotificationActionsBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "registerCategories", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Category and action identifiers (mirrored in bridge.ts)

    static let taskCategoryId = "JARVIS_TASK"
    static let doneActionId = "JARVIS_DONE"
    static let tomorrowActionId = "JARVIS_TOMORROW"

    // MARK: - Registration

    @objc func registerCategories(_ call: CAPPluginCall) {
        let done = UNNotificationAction(
            identifier: Self.doneActionId,
            title: "Done",
            options: []
        )
        let tomorrow = UNNotificationAction(
            identifier: Self.tomorrowActionId,
            title: "Tomorrow",
            options: []
        )
        let task = UNNotificationCategory(
            identifier: Self.taskCategoryId,
            actions: [done, tomorrow],
            intentIdentifiers: [],
            options: []
        )
        let center = UNUserNotificationCenter.current()
        center.setNotificationCategories([task])
        center.delegate = self
        call.resolve()
    }

    // MARK: - Action handling

    // Both actions run without opening the app when possible. The event
    // reaches JS as {action: "done" | "tomorrow", taskId}; bridge.ts routes
    // done to completion and tomorrow through the Auto-Sweep push path.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        let userInfo = response.notification.request.content.userInfo
        guard let taskId = userInfo["taskId"] as? String else { return }
        switch response.actionIdentifier {
        case Self.doneActionId:
            notifyListeners("notificationAction", data: ["action": "done", "taskId": taskId])
        case Self.tomorrowActionId:
            notifyListeners("notificationAction", data: ["action": "tomorrow", "taskId": taskId])
        default:
            // Tapping the body opens the app on the task via deep link;
            // no action event fires.
            break
        }
    }

    // Foreground banners still show (the app may be open on another screen).
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
