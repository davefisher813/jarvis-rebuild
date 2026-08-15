// HealthKitPlugin.swift
// JARVIS native seven, item 1: Apple Health, read only.
//
// Staged uncompiled 2026-08-15. Compiles once the Xcode target gains the
// HealthKit capability. Registers as the Capacitor plugin behind
// src/native/bridge.ts HealthBridge. Read scopes are workouts, steps, and
// sleep, and nothing else; there is deliberately no HKSampleType in the
// share set and no save call anywhere in this file. JARVIS never writes
// to Health.
//
// Dedupe policy (enforced in TypeScript, src/native/healthDedupe.ts): a
// JARVIS-native session overlapping an imported workout's window is one
// record and JARVIS wins. This plugin only reports raw samples.
//
// TODO(signing): add the com.apple.developer.healthkit entitlement and the
// HealthKit capability to the App target after enrollment clears.
// TODO(signing): NSHealthShareUsageDescription string from
// native/InfoPlist-strings.md must be in Info.plist before any query runs.

import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReadAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySleep", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    // MARK: - Read scopes (the whole list; adding one is a policy change)

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) { types.insert(steps) }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    // MARK: - Authorization (read only: toShare is nil, always)

    @objc func requestReadAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["status": "denied"])
            return
        }
        store.requestAuthorization(toShare: nil, read: readTypes) { granted, error in
            if let error = error {
                call.reject("health authorization failed", nil, error)
                return
            }
            // HealthKit hides per-type read grants by design; granted here
            // means the sheet completed. The queries below simply return
            // empty for anything the user withheld.
            call.resolve(["status": granted ? "granted" : "denied"])
        }
    }

    // MARK: - Workouts

    @objc func queryWorkouts(_ call: CAPPluginCall) {
        let sinceMs = call.getDouble("sinceMs") ?? 0
        let since = Date(timeIntervalSince1970: sinceMs / 1000)
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if let error = error {
                call.reject("workout query failed", nil, error)
                return
            }
            let workouts = (samples as? [HKWorkout] ?? []).map { w -> [String: Any] in
                var record: [String: Any] = [
                    "uid": w.uuid.uuidString,
                    "start": w.startDate.timeIntervalSince1970 * 1000,
                    "end": w.endDate.timeIntervalSince1970 * 1000,
                    "activityType": Self.activityName(w.workoutActivityType),
                    "sourceName": w.sourceRevision.source.name,
                ]
                if let energy = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity() {
                    record["calories"] = energy.doubleValue(for: .kilocalorie())
                }
                return record
            }
            call.resolve(["workouts": workouts])
        }
        store.execute(query)
    }

    // MARK: - Steps (daily totals via statistics collection)

    @objc func querySteps(_ call: CAPPluginCall) {
        guard let stepsType = HKObjectType.quantityType(forIdentifier: .stepCount),
              let fromISO = call.getString("fromDayISO"),
              let toISO = call.getString("toDayISO"),
              let from = Self.dayStart(fromISO),
              let to = Self.dayEnd(toISO) else {
            call.reject("bad steps query input")
            return
        }
        var interval = DateComponents()
        interval.day = 1
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
        let query = HKStatisticsCollectionQuery(quantityType: stepsType, quantitySamplePredicate: predicate, options: .cumulativeSum, anchorDate: from, intervalComponents: interval)
        query.initialResultsHandler = { _, collection, error in
            if let error = error {
                call.reject("steps query failed", nil, error)
                return
            }
            var days: [[String: Any]] = []
            collection?.enumerateStatistics(from: from, to: to) { stats, _ in
                let count = stats.sumQuantity()?.doubleValue(for: .count()) ?? 0
                days.append(["dayISO": Self.isoDay(stats.startDate), "steps": Int(count)])
            }
            call.resolve(["days": days])
        }
        store.execute(query)
    }

    // MARK: - Sleep (asleep vs in-bed minutes per night)

    @objc func querySleep(_ call: CAPPluginCall) {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
              let fromISO = call.getString("fromDayISO"),
              let toISO = call.getString("toDayISO"),
              let from = Self.dayStart(fromISO),
              let to = Self.dayEnd(toISO) else {
            call.reject("bad sleep query input")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: [])
        let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
            if let error = error {
                call.reject("sleep query failed", nil, error)
                return
            }
            // Bucket by the morning the sample ENDS on: a night belongs to
            // the day you woke up.
            var asleep: [String: Double] = [:]
            var inBed: [String: Double] = [:]
            for sample in (samples as? [HKCategorySample] ?? []) {
                let day = Self.isoDay(sample.endDate)
                let minutes = sample.endDate.timeIntervalSince(sample.startDate) / 60
                if Self.isAsleepValue(sample.value) {
                    asleep[day, default: 0] += minutes
                } else if sample.value == HKCategoryValueSleepAnalysis.inBed.rawValue {
                    inBed[day, default: 0] += minutes
                }
            }
            let nights = Set(asleep.keys).union(inBed.keys).sorted().map { day in
                ["dayISO": day, "asleepMinutes": Int(asleep[day] ?? 0), "inBedMinutes": Int(inBed[day] ?? 0)] as [String: Any]
            }
            call.resolve(["nights": nights])
        }
        store.execute(query)
    }

    // MARK: - Helpers

    private static func isAsleepValue(_ value: Int) -> Bool {
        let asleepValues: [HKCategoryValueSleepAnalysis] = [.asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM]
        return asleepValues.map { $0.rawValue }.contains(value)
    }

    private static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .traditionalStrengthTraining: return "traditionalStrengthTraining"
        case .functionalStrengthTraining: return "functionalStrengthTraining"
        case .highIntensityIntervalTraining: return "hiit"
        case .yoga: return "yoga"
        case .rowing: return "rowing"
        case .elliptical: return "elliptical"
        case .stairClimbing: return "stairClimbing"
        case .coreTraining: return "coreTraining"
        case .basketball: return "basketball"
        case .soccer: return "soccer"
        case .americanFootball: return "football"
        case .baseball: return "baseball"
        case .tennis: return "tennis"
        case .golf: return "golf"
        case .hiking: return "hiking"
        case .martialArts: return "martialArts"
        default: return "other"
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        return f
    }()

    private static func isoDay(_ date: Date) -> String { dayFormatter.string(from: date) }
    private static func dayStart(_ iso: String) -> Date? { dayFormatter.date(from: iso) }
    private static func dayEnd(_ iso: String) -> Date? {
        guard let start = dayFormatter.date(from: iso) else { return nil }
        return Calendar.current.date(byAdding: .day, value: 1, to: start)
    }
}
