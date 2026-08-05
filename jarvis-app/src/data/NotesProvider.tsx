import { createContext, useContext, useMemo, type ReactNode } from "react";
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
import { makeStore } from "./store";
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
const BackupContext = createContext<BackupService | null>(null);
const RoutineContext = createContext<RoutineService | null>(null);
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
  const { notes, tasks, schedule, categories, profile, people, brainDocs, areas, goals, projects, money, backup, routine, gym } = useMemo(() => {
    const store = makeStore(accessToken);
    return {
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
    };
  }, [userId, accessToken]);
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
                      <GymContext.Provider value={gym}>{children}</GymContext.Provider>
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

export function useGym(): GymService {
  const s = useContext(GymContext);
  if (!s) throw new Error("useGym must be used inside NotesProvider");
  return s;
}

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

export function useAccessToken(): string | undefined {
  return useContext(TokenContext);
}
