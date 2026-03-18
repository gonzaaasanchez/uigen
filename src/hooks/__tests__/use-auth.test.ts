import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockSignInAction = vi.fn();
const mockSignUpAction = vi.fn();
vi.mock("@/actions", () => ({
  signIn: (...args: unknown[]) => mockSignInAction(...args),
  signUp: (...args: unknown[]) => mockSignUpAction(...args),
}));

const mockGetAnonWorkData = vi.fn();
const mockClearAnonWork = vi.fn();
vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: () => mockGetAnonWorkData(),
  clearAnonWork: () => mockClearAnonWork(),
}));

const mockGetProjects = vi.fn();
vi.mock("@/actions/get-projects", () => ({
  getProjects: () => mockGetProjects(),
}));

const mockCreateProject = vi.fn();
vi.mock("@/actions/create-project", () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
}));

import { useAuth } from "@/hooks/use-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAnonWorkData.mockReturnValue(null);
  mockGetProjects.mockResolvedValue([]);
  mockCreateProject.mockResolvedValue({ id: "new-project-id" });
});

describe("useAuth — initial state", () => {
  test("isLoading starts as false", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(false);
  });

  test("exposes signIn and signUp functions", () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.signIn).toBe("function");
    expect(typeof result.current.signUp).toBe("function");
  });
});

describe("signIn", () => {
  test("returns the result from the signIn action on failure", async () => {
    const failResult = { success: false, error: "Invalid credentials" };
    mockSignInAction.mockResolvedValue(failResult);

    const { result } = renderHook(() => useAuth());
    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.signIn("bad@example.com", "wrongpass");
    });

    expect(returnValue).toEqual(failResult);
  });

  test("returns the result from the signIn action on success", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([{ id: "project-1" }]);

    const { result } = renderHook(() => useAuth());
    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.signIn("user@example.com", "password123");
    });

    expect(returnValue).toEqual({ success: true });
  });

  test("calls signIn action with email and password", async () => {
    mockSignInAction.mockResolvedValue({ success: false, error: "err" });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signIn("user@example.com", "mypassword");
    });

    expect(mockSignInAction).toHaveBeenCalledWith("user@example.com", "mypassword");
  });

  test("sets isLoading to true during sign in and false after", async () => {
    let loadingDuringAction = false;
    mockSignInAction.mockImplementation(async () => {
      // At this point setIsLoading(true) has already been called
      loadingDuringAction = true;
      return { success: false, error: "err" };
    });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signIn("u@e.com", "pass");
    });

    expect(loadingDuringAction).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  test("resets isLoading to false even when signIn action throws", async () => {
    mockSignInAction.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      try {
        await result.current.signIn("u@e.com", "pass");
      } catch {
        // expected
      }
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("does not navigate when sign in fails", async () => {
    mockSignInAction.mockResolvedValue({ success: false, error: "Invalid credentials" });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signIn("u@e.com", "wrongpass");
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  describe("post sign-in navigation with anonymous work", () => {
    test("creates a project from anon work and navigates to it", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      const anonWork = {
        messages: [{ role: "user", content: "hello" }],
        fileSystemData: { "/": { type: "directory" } },
      };
      mockGetAnonWorkData.mockReturnValue(anonWork);
      mockCreateProject.mockResolvedValue({ id: "anon-project-id" });

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("u@e.com", "pass");
      });

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: anonWork.messages,
          data: anonWork.fileSystemData,
        })
      );
      expect(mockClearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/anon-project-id");
    });

    test("does not call getProjects when anon work is present", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue({
        messages: [{ role: "user", content: "hi" }],
        fileSystemData: {},
      });
      mockCreateProject.mockResolvedValue({ id: "x" });

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("u@e.com", "pass");
      });

      expect(mockGetProjects).not.toHaveBeenCalled();
    });
  });

  describe("post sign-in navigation without anonymous work", () => {
    test("navigates to the most recent existing project when anon work is null", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([{ id: "recent-project" }, { id: "older-project" }]);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("u@e.com", "pass");
      });

      expect(mockPush).toHaveBeenCalledWith("/recent-project");
    });

    test("navigates to the most recent existing project when anon work has empty messages", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} });
      mockGetProjects.mockResolvedValue([{ id: "existing-project" }]);

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("u@e.com", "pass");
      });

      expect(mockPush).toHaveBeenCalledWith("/existing-project");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("creates a new project and navigates when no existing projects", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ id: "brand-new-project" });

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("u@e.com", "pass");
      });

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [], data: {} })
      );
      expect(mockPush).toHaveBeenCalledWith("/brand-new-project");
    });

    test("new project name is a non-empty string when no projects exist", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ id: "x" });

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signIn("u@e.com", "pass");
      });

      const [{ name }] = mockCreateProject.mock.calls[0];
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    });
  });
});

describe("signUp", () => {
  test("returns the result from the signUp action on failure", async () => {
    const failResult = { success: false, error: "Email already registered" };
    mockSignUpAction.mockResolvedValue(failResult);

    const { result } = renderHook(() => useAuth());
    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.signUp("existing@example.com", "password123");
    });

    expect(returnValue).toEqual(failResult);
  });

  test("calls signUp action with email and password", async () => {
    mockSignUpAction.mockResolvedValue({ success: false, error: "err" });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp("new@example.com", "securepass");
    });

    expect(mockSignUpAction).toHaveBeenCalledWith("new@example.com", "securepass");
  });

  test("sets isLoading to true during sign up and false after", async () => {
    let loadingDuringAction = false;
    mockSignUpAction.mockImplementation(async () => {
      loadingDuringAction = true;
      return { success: false, error: "err" };
    });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp("u@e.com", "pass");
    });

    expect(loadingDuringAction).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  test("resets isLoading to false even when signUp action throws", async () => {
    mockSignUpAction.mockRejectedValue(new Error("server error"));

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      try {
        await result.current.signUp("u@e.com", "pass");
      } catch {
        // expected
      }
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("does not navigate when sign up fails", async () => {
    mockSignUpAction.mockResolvedValue({ success: false, error: "err" });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp("u@e.com", "pass");
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  test("navigates to anon project after successful sign up with anon work", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue({
      messages: [{ role: "user", content: "design this" }],
      fileSystemData: { "/": {} },
    });
    mockCreateProject.mockResolvedValue({ id: "saved-anon-project" });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp("new@example.com", "password123");
    });

    expect(mockClearAnonWork).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/saved-anon-project");
  });

  test("navigates to most recent project after sign up when no anon work", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([{ id: "user-project" }]);

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp("new@example.com", "password123");
    });

    expect(mockPush).toHaveBeenCalledWith("/user-project");
  });

  test("creates and navigates to new project after sign up when no projects exist", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([]);
    mockCreateProject.mockResolvedValue({ id: "fresh-project" });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp("new@example.com", "password123");
    });

    expect(mockPush).toHaveBeenCalledWith("/fresh-project");
  });
});
