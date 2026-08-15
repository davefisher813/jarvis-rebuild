// EventKitPlugin.swift
// JARVIS native seven, item 2: Apple Calendar + Reminders via EventKit.
//
// Staged uncompiled 2026-08-15. Read everything; write ONE thing:
// completeReminder marks an imported reminder complete in the Reminders app
// so the two lists never disagree about done. No other mutation exists in
// this file, and none may be added without a policy change.
//
// Dedupe (in TypeScript, src/native/eventKitDedupe.ts): iCal UID first,
// then title + 30 minute start window. This plugin reports raw records
// keyed by calendarItemExternalIdentifier (the iCal UID).
//
// TODO(signing): Info.plist needs NSCalendarsFullAccessUsageDescription and
// NSRemindersFullAccessUsageDescription from native/InfoPlist-strings.md.

import Foundation
import Capacitor
import EventKit

@objc(EventKitPlugin)
public class EventKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EventKitPlugin"
    public let jsName = "EventKitBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestCalendarAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestRemindersAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryReminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "completeReminder", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()

    // MARK: - Access

    @objc func requestCalendarAccess(_ call: CAPPluginCall) {
        store.requestFullAccessToEvents { granted, error in
            if let error = error { call.reject("calendar access failed", nil, error); return }
            call.resolve(["granted": granted])
        }
    }

    @objc func requestRemindersAccess(_ call: CAPPluginCall) {
        store.requestFullAccessToReminders { granted, error in
            if let error = error { call.reject("reminders access failed", nil, error); return }
            call.resolve(["granted": granted])
        }
    }

    // MARK: - Events (read)

    @objc func queryEvents(_ call: CAPPluginCall) {
        guard let startMs = call.getDouble("windowStartMs"), let endMs = call.getDouble("windowEndMs") else {
            call.reject("bad event window")
            return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = store.events(matching: predicate).map { e -> [String: Any] in
            var record: [String: Any] = [
                "icalUid": e.calendarItemExternalIdentifier ?? e.calendarItemIdentifier,
                "title": e.title ?? "",
                "start": e.startDate.timeIntervalSince1970 * 1000,
                "end": e.endDate.timeIntervalSince1970 * 1000,
                "allDay": e.isAllDay,
            ]
            if let calendar = e.calendar { record["calendarTitle"] = calendar.title }
            if let location = e.location, !location.isEmpty { record["location"] = location }
            return record
        }
        call.resolve(["events": events])
    }

    // MARK: - Reminders (read)

    @objc func queryReminders(_ call: CAPPluginCall) {
        let predicate = store.predicateForReminders(in: nil)
        store.fetchReminders(matching: predicate) { reminders in
            let records = (reminders ?? []).map { r -> [String: Any] in
                var record: [String: Any] = [
                    "icalUid": r.calendarItemExternalIdentifier ?? r.calendarItemIdentifier,
                    "title": r.title ?? "",
                    "completed": r.isCompleted,
                ]
                if let calendar = r.calendar { record["listTitle"] = calendar.title }
                if let components = r.dueDateComponents, let due = Calendar.current.date(from: components) {
                    record["due"] = due.timeIntervalSince1970 * 1000
                }
                return record
            }
            call.resolve(["reminders": records])
        }
    }

    // MARK: - The one write

    // Completing an imported reminder in JARVIS marks it complete in the
    // Reminders app. Nothing else is ever written: no creation, no edits,
    // no deletion, no calendar writes.
    @objc func completeReminder(_ call: CAPPluginCall) {
        guard let uid = call.getString("icalUid") else {
            call.reject("missing reminder uid")
            return
        }
        let predicate = store.predicateForReminders(in: nil)
        store.fetchReminders(matching: predicate) { [weak self] reminders in
            guard let self = self else { return }
            let match = (reminders ?? []).first { r in
                (r.calendarItemExternalIdentifier ?? r.calendarItemIdentifier) == uid
            }
            guard let reminder = match else {
                call.resolve(["ok": false])
                return
            }
            reminder.isCompleted = true
            do {
                try self.store.save(reminder, commit: true)
                call.resolve(["ok": true])
            } catch {
                call.reject("reminder completion failed", nil, error)
            }
        }
    }
}
