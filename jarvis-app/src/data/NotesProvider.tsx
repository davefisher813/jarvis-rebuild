import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { NotesService } from "../notes/NotesService";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { CategoriesService } from "../categories/CategoriesService";
import { ProfileService } from "../profile/ProfileService";
import { PeopleService } from "../people/PeopleService";
import { BrainDocService } from "../brain/docs/BrainDocService";
import { AreaService } from "../life/AreaService";
import { GoalService } from "../life/GoalService";
import { ProjectsService } from "../projects/ProjectsService";
import { MoneyService } from "../money/MoneyService";
import { BackupService } from "../backup/BackupService";
import { RoutineService } from "../routine/RoutineService";
import { GymService } from "../gym/GymService";
import { MetricsService } from "../gym/MetricsService";
import { HealthService } from "../health/HealthService";
import { LearnedRulesService } from "../rules/LearnedRulesService";
import { ChatService } from "../chat/ChatService";
import { DecisionService } from "../decisions/DecisionService";
import { StrandsService } from "../brain/strands/StrandsService";
import { SealService } from "../review/seal";
import { FilesService } from "../files/FilesService";
import { MemoryFileStore, SupabaseFileStore, type FileStore } from "../files/FileStore";
import { supabase } from "../auth/supabaseClient";
import { makeStore } from "./store";
import { wireOfflineSync } from "./offlineSync";
import { emit } from "../events";

// One store per session, shared by Notes, Tasks, and Schedule, so cross-feature
// data lines up (a task from a note checklist shows in Tasks; everything feeds
// Today later). All services are wired to the event bus for capture.
const NotesContext = createContext<NotesService | null>(null);
const TasksContext = createContext<TasksService | null>(null);
const ScheduleContext = createContext<ScheduleService | null>(null);
const CategoriesContext = createContext<CategoriesService | null>(null);
const ProfileContext = createContext<ProfileService | null>(null);
const PeopleContext = createContext<PeopleService | null>(null);
const BrainDocContext = createContext<BrainDocService | null>(null);
const AreaContext = createContext<AreaService | null>(null);
const GoalContext = createContext<GoalService | null>(null);
const ProjectContext = createContext<ProjectsService | null>(null);
const MoneyContext = createContext<MoneyService | null>(null);
const GymContext = createContext<GymService | null>(null);
const MetricsContext = createContext<MetricsService | null>(null);
// S5-Q29 (2026-09-04): the Health module's service, real and fully tested
// since Track 3's own build, had no seat in this provider at all -- the
// first thing "wiring it in" needs. See src/brain/CategoryDetail.tsx for
// the first real consumer (the health area page's grafted loggers).
const HealthContext = createContext<HealthService | null>(null);
const RulesContext = createContext<LearnedRulesService | null>(null);
const BackupContext = createContext<BackupService | null>(null);
const RoutineContext = createContext<RoutineService | null>(null);
const ChatContext = createContext<ChatService | null>(null);
const DecisionContext = createContext<DecisionService | null>(null);
const StrandsContext = createContext<StrandsService | null>(null);
const SealContext = createContext<SealService | null>(null);
const FilesContext = createContext<FilesService | null>(null);
const FileStoreContext = createContext<FileStore | null>(null);
// The Supabase access token, for callers that hit privileged endpoints (e.g.
// the admin check). Undefined when signed out or in the local harness.
const TokenContext = createContext<string | undefined>(undefined);

export function NotesProvider({
  userId,
  accessToken,
  children,
}: {
  userId: string;
  accessToken?: string;
  children: ReactNode;
}) {
  const { store, notes, tasks, schedule, categories, profile, people, brainDocs, areas, goals, projects, money, backup, routine, gym, metrics, health, rules, chat, decisions, strands, seal, files, fileStore } = useMemo(() => {
    const store = makeStore(accessToken, userId);
    return {
      store,
      files: new FilesService(store, userId, (e) => emit(e)),
      // The bytes: Supabase Storage when signed in, the demo's shelf otherwise.
      fileStore: supabase && accessToken ? new SupabaseFileStore(supabase, userId) : new MemoryFileStore(userId),
      rules: new LearnedRulesService(store, userId),
      notes: new NotesService(store, userId, (e) => emit(e)),
      tasks: new TasksService(store, userId, (e) => emit(e)),
      schedule: new ScheduleService(store, userId, (e) => emit(e)),
      categories: new CategoriesService(store, userId, (e) => emit(e)),
      profile: new ProfileService(store, userId),
      people: new PeopleService(store, userId, (e) => emit(e)),
      brainDocs: new BrainDocService(store, userId),
      areas: new AreaService(store, userId, (e) => emit(e)),
      goals: new GoalService(store, userId, (e) => emit(e)),
      projects: new ProjectsService(store, userId, (e) => emit(e)),
      money: new MoneyService(store, userId, (e) => emit(e)),
      backup: new BackupService(store, userId),
      routine: new RoutineService(store, userId),
      gym: new GymService(store, userId, (e) => emit(e)),
      metrics: new MetricsService(store, userId, (e) => emit(e)),
      health: new HealthService(store, userId, (e) => emit(e)),
      chat: new ChatService(store, userId),
      decisions: new DecisionService(store, userId, (e) => emit(e)),
      strands: new StrandsService(store, userId, (e) => emit(e)),
      seal: new SealService(store, userId, (e) => emit(e)),
    };
  }, [userId, accessToken]);
  // S3-Q14: real connectivity, not a pass-through only a test ever calls.
  // Tied to `store` itself (not [] ) so a token refresh or a different
  // signed-in user, each of which builds a fresh Store above, re-wires
  // against the new one instead of leaking a listener onto an abandoned one.
  useEffect(() => wireOfflineSync(store), [store]);
  return (
    <TokenContext.Provider value={accessToken}>
    <NotesContext.Provider value={notes}>
      <TasksContext.Provider value={tasks}>
        <ScheduleContext.Provider value={schedule}>
          <CategoriesContext.Provider value={categories}>
            <ProfileContext.Provider value={profile}>
              <PeopleContext.Provider value={people}>
                <BrainDocContext.Provider value={brainDocs}>
                  <AreaContext.Provider value={areas}>
                    <GoalContext.Provider value={goals}>
                      <ProjectContext.Provider value={projects}>
                      <MoneyContext.Provider value={money}>
                      <BackupContext.Provider value={backup}>
                      <RoutineContext.Provider value={routine}>
                      <GymContext.Provider value={gym}>
                      <MetricsContext.Provider value={metrics}>
                      <HealthContext.Provider value={health}>
                      <RulesContext.Provider value={rules}>
                      <ChatContext.Provider value={chat}>
                      <DecisionContext.Provider value={decisions}>
                      <StrandsContext.Provider value={strands}><SealContext.Provider value={seal}>
                      <FilesContext.Provider value={files}><FileStoreContext.Provider value={fileStore}>{children}</FileStoreContext.Provider></FilesContext.Provider>
                      </SealContext.Provider></StrandsContext.Provider>
                      </DecisionContext.Provider>
                      </ChatContext.Provider>
                      </RulesContext.Provider>
                      </HealthContext.Provider>
                      </MetricsContext.Provider>
                      </GymContext.Provider>
                      </RoutineContext.Provider>
                      </BackupContext.Provider>
                      </MoneyContext.Provider>
                    </ProjectContext.Provider>
                    </GoalContext.Provider>
                  </AreaContext.Provider>
                </BrainDocContext.Provider>
              </PeopleContext.Provider>
            </ProfileContext.Provider>
          </CategoriesContext.Provider>
        </ScheduleContext.Provider>
      </TasksContext.Provider>
    </NotesContext.Provider>
    </TokenContext.Provider>
  );
}

// Optional, for tabs that render without the provider above them (the same
// shape every other optional service here uses).
export function useOptionalNotes(): NotesService | null { return useContext(NotesContext) ?? null; }

export function useNotes(): NotesService {
  const s = useContext(NotesContext);
  if (!s) throw new Error("useNotes must be used inside NotesProvider");
  return s;
}

export function useTasks(): TasksService {
  const s = useContext(TasksContext);
  if (!s) throw new Error("useTasks must be used inside NotesProvider");
  return s;
}

// For features where tasks are an ENHANCEMENT, not a requirement (the email
// safety net, for one): outside NotesProvider this returns null instead of
// throwing, so the bench and component tests need no data stack.
export function useOptionalTasks(): TasksService | null {
  return useContext(TasksContext) ?? null;
}

// Same principle as useOptionalTasks: the email tab offers hand-off only when
// there is a people list to offer from, and renders fine when there is not.
export function useOptionalPeople(): PeopleService | null {
  return useContext(PeopleContext) ?? null;
}

// The rest of the optional accessors, added so useOptionalAIContext can
// assemble the user's context WITHOUT turning a soft dependency into a hard
// one (Brain Personalization Phase 3). MessagesFlow is the reason: it is
// built to render outside this provider, and personalizing its drafts must
// not quietly cost it that. Every one of these returns null instead of
// throwing, which is the only difference from the required versions above.
export function useOptionalProfile(): ProfileService | null { return useContext(ProfileContext) ?? null; }
export function useOptionalBrainDocs(): BrainDocService | null { return useContext(BrainDocContext) ?? null; }
export function useOptionalSchedule(): ScheduleService | null { return useContext(ScheduleContext) ?? null; }
export function useOptionalCategories(): CategoriesService | null { return useContext(CategoriesContext) ?? null; }
export function useOptionalRoutine(): RoutineService | null { return useContext(RoutineContext) ?? null; }
export function useOptionalGoals(): GoalService | null { return useContext(GoalContext) ?? null; }
export function useOptionalProjects(): ProjectsService | null { return useContext(ProjectContext) ?? null; }
export function useOptionalMoney(): MoneyService | null { return useContext(MoneyContext) ?? null; }

export function useSchedule(): ScheduleService {
  const s = useContext(ScheduleContext);
  if (!s) throw new Error("useSchedule must be used inside NotesProvider");
  return s;
}

export function useCategories(): CategoriesService {
  const s = useContext(CategoriesContext);
  if (!s) throw new Error("useCategories must be used inside NotesProvider");
  return s;
}

export function useProfile(): ProfileService {
  const s = useContext(ProfileContext);
  if (!s) throw new Error("useProfile must be used inside NotesProvider");
  return s;
}

export function usePeople(): PeopleService {
  const s = useContext(PeopleContext);
  if (!s) throw new Error("usePeople must be used inside NotesProvider");
  return s;
}

export function useBrainDocs(): BrainDocService {
  const s = useContext(BrainDocContext);
  if (!s) throw new Error("useBrainDocs must be used inside NotesProvider");
  return s;
}

export function useAreas(): AreaService {
  const s = useContext(AreaContext);
  if (!s) throw new Error("useAreas must be used inside NotesProvider");
  return s;
}

export function useGoals(): GoalService {
  const s = useContext(GoalContext);
  if (!s) throw new Error("useGoals must be used inside NotesProvider");
  return s;
}

export function useProjects(): ProjectsService {
  const s = useContext(ProjectContext);
  if (!s) throw new Error("useProjects must be used inside NotesProvider");
  return s;
}

export function useMoney(): MoneyService {
  const s = useContext(MoneyContext);
  if (!s) throw new Error("useMoney must be used inside NotesProvider");
  return s;
}

export function useRules(): LearnedRulesService {
  const s = useContext(RulesContext);
  if (!s) throw new Error("useRules must be used inside NotesProvider");
  return s;
}

// Rules are an enhancement at decision points; outside NotesProvider they
// simply do not exist (same principle as useOptionalTasks).
export function useSeal(): SealService {
  const s = useContext(SealContext);
  if (!s) throw new Error("useSeal outside provider");
  return s;
}
export function useOptionalSeal(): SealService | null { return useContext(SealContext) ?? null; }
export function useFiles(): FilesService {
  const v = useContext(FilesContext);
  if (!v) throw new Error("useFiles must be used within NotesProvider");
  return v;
}
export function useOptionalFiles(): FilesService | null { return useContext(FilesContext) ?? null; }
export function useFileStore(): FileStore | null { return useContext(FileStoreContext) ?? null; }
export function useOptionalRules(): LearnedRulesService | null {
  return useContext(RulesContext) ?? null;
}

export function useGym(): GymService {
  const s = useContext(GymContext);
  if (!s) throw new Error("useGym must be used inside NotesProvider");
  return s;
}
/** D4-C: the schedule reads the gym (pinned day, estimate, last trained)
 *  without demanding it exists -- same shape as every other optional hook. */
export function useOptionalGym(): GymService | null { return useContext(GymContext) ?? null; }

export function useMetrics(): MetricsService {
  const s = useContext(MetricsContext);
  if (!s) throw new Error("useMetrics must be used inside NotesProvider");
  return s;
}
/** D10-B: the Health page reads metrics without demanding they exist, same
 *  shape as useOptionalGym. */
export function useOptionalMetrics(): MetricsService | null { return useContext(MetricsContext) ?? null; }

// S5-Q29 (2026-09-04): the Track 3 health track's own service, real and
// tested since it was built, registered here for the first time so anything
// under NotesProvider can finally reach it. Required, same shape as
// useGym/useMetrics: every render of the health area page already sits
// inside a full NotesProvider (same tree gym/metrics already assume).
export function useHealth(): HealthService {
  const s = useContext(HealthContext);
  if (!s) throw new Error("useHealth must be used inside NotesProvider");
  return s;
}
export function useOptionalHealth(): HealthService | null { return useContext(HealthContext) ?? null; }

export function useRoutine(): RoutineService {
  const s = useContext(RoutineContext);
  if (!s) throw new Error("useRoutine must be used inside NotesProvider");
  return s;
}

export function useBackup(): BackupService {
  const s = useContext(BackupContext);
  if (!s) throw new Error("useBackup must be used inside NotesProvider");
  return s;
}

export function useChat(): ChatService {
  const s = useContext(ChatContext);
  if (!s) throw new Error("useChat must be used inside NotesProvider");
  return s;
}

export function useDecisions(): DecisionService {
  const s = useContext(DecisionContext);
  if (!s) throw new Error("useDecisions must be used inside NotesProvider");
  return s;
}

// The payoff banner on project pages is an enhancement, never a requirement:
// outside NotesProvider it simply does not exist (same principle as
// useOptionalTasks).
export function useOptionalDecisions(): DecisionService | null {
  return useContext(DecisionContext) ?? null;
}

export function useStrands(): StrandsService {
  const s = useContext(StrandsContext);
  if (!s) throw new Error("useStrands must be used inside NotesProvider");
  return s;
}

// Strands are an enhancement everywhere they appear (context lines, plan
// attribution); outside NotesProvider they simply do not exist.
export function useOptionalStrands(): StrandsService | null {
  return useContext(StrandsContext) ?? null;
}

export function useAccessToken(): string | undefined {
  return useContext(TokenContext);
}
