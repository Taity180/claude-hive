import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render } from "@testing-library/react";
import { CollapsedBar } from "./CollapsedBar";
import { useHubStore } from "../stores/hubStore";

describe("CollapsedBar", () => {
  it("forwards ref to the root content element so the window sizer can measure it", () => {
    useHubStore.setState({
      sessions: [],
      messages: {},
      unreadSessions: new Set(),
    });

    const ref = createRef<HTMLDivElement>();
    render(<CollapsedBar ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName).toBe("DIV");
  });

  it("renders the empty state when no sessions are connected", () => {
    useHubStore.setState({
      sessions: [],
      messages: {},
      unreadSessions: new Set(),
    });

    const { getByText } = render(<CollapsedBar />);
    expect(getByText("No sessions connected")).toBeInTheDocument();
  });
});
