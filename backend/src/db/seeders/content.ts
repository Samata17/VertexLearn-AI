/**
 * Demo course content. Transcripts are real teaching text with [mm:ss] markers so the
 * AI tutor has genuine material to retrieve from and cite (with video timestamps).
 *
 * Videos: the lecture videos are publicly available SAMPLE clips used as placeholders
 * (they are not recordings of these lectures). Instructors replace them by uploading real videos.
 */
const V = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/';
export const SAMPLE_VIDEOS = [
  { url: `${V}ForBiggerBlazes.mp4`, seconds: 15 },
  { url: `${V}ForBiggerEscapes.mp4`, seconds: 15 },
  { url: `${V}ForBiggerFun.mp4`, seconds: 60 },
  { url: `${V}ForBiggerJoyrides.mp4`, seconds: 15 },
  { url: `${V}ForBiggerMeltdowns.mp4`, seconds: 15 },
  { url: `${V}BigBuckBunny.mp4`, seconds: 596 },
  { url: `${V}ElephantsDream.mp4`, seconds: 653 },
  { url: `${V}Sintel.mp4`, seconds: 888 },
  { url: `${V}TearsOfSteel.mp4`, seconds: 734 },
  { url: `${V}SubaruOutbackOnStreetAndDirt.mp4`, seconds: 594 },
];

export interface SeedLecture { title: string; transcript: string }
export interface SeedModule { title: string; lectures: SeedLecture[] }
export interface SeedCourse {
  key: string;
  instructor: string; // instructor email
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  price: number;
  status: 'approved' | 'pending' | 'rejected';
  outcomes: string[];
  modules: SeedModule[];
}

export const COURSES: SeedCourse[] = [
  {
    key: 'dsa',
    instructor: 'rohit@vertexlearn.ai',
    title: 'Data Structures & Algorithms Masterclass',
    description:
      'Build a rock-solid foundation in data structures and algorithms. Learn to analyse complexity, master sorting and searching, work with trees and graphs, and develop the problem-solving instincts that technical interviews test.',
    category: 'Computer Science',
    difficulty: 'intermediate',
    price: 1499,
    status: 'approved',
    outcomes: [
      'Analyse time and space complexity with Big-O notation',
      'Implement merge sort and quicksort and explain their trade-offs',
      'Use binary search and binary search trees correctly',
      'Traverse graphs with BFS and DFS',
    ],
    modules: [
      {
        title: 'Complexity & Foundations',
        lectures: [
          {
            title: 'Big-O Notation Explained',
            transcript: `[00:00] Welcome to the course. Before we write a single algorithm, we need a language for talking about how fast code is. That language is Big-O notation.
[00:42] Big-O describes how the running time of an algorithm grows as the input size n grows. We don't care about exact seconds, because those depend on the machine. We care about the shape of the growth curve.
[01:30] Constant time, written O(1), means the work doesn't depend on n at all. Reading an array element by its index is O(1): whether the array has ten items or ten million, one memory lookup gets the value.
[02:15] Linear time, O(n), means the work grows in proportion to the input. Scanning an unsorted list to find the maximum is O(n), because you must look at every element once.
[03:05] Quadratic time, O(n squared), usually comes from a loop inside a loop over the same data. Comparing every pair of elements is quadratic. Doubling the input makes the work four times larger, which becomes painful very quickly.
[04:10] Logarithmic time, O(log n), appears when each step cuts the problem in half. Binary search is the classic example: a sorted array of a million elements needs only about twenty comparisons.
[05:00] O(n log n) sits between linear and quadratic. It is the best possible worst-case time for comparison-based sorting, and it is what merge sort achieves.
[05:45] When we simplify Big-O we drop constants and lower-order terms. An algorithm doing 3n plus 50 steps is simply O(n), because for large n the constant factors stop mattering compared with the growth rate.
[06:30] Remember that Big-O usually describes the worst case. Some algorithms, like quicksort, have a very good average case but a bad worst case, and we will see exactly why later in the course.`,
          },
          {
            title: 'Arrays and Linked Lists',
            transcript: `[00:00] In this lecture we compare the two most fundamental sequential data structures: arrays and linked lists.
[00:35] An array stores elements in one contiguous block of memory. Because every element has the same size, the address of element i can be computed directly. That is why random access by index is O(1).
[01:20] The downside of arrays is insertion and deletion in the middle. To insert at position k you must shift every later element one place to the right, which costs O(n) in the worst case.
[02:10] Dynamic arrays, like Python lists or JavaScript arrays, grow automatically. When they run out of space they allocate a bigger block, usually double the size, and copy everything across. Appending is therefore amortized O(1): most appends are cheap and the occasional copy is spread across many operations.
[03:15] A linked list stores each element in a node that also holds a pointer to the next node. Nodes can live anywhere in memory.
[03:50] Inserting or deleting a node is O(1) once you hold a reference to the right position, because you only rewire a couple of pointers. But finding the k-th element requires walking the list from the head, which is O(n).
[04:40] Linked lists also have worse cache behaviour. Arrays are fast in practice because the CPU loads neighbouring elements together; linked list nodes are scattered, so each step may be a cache miss.
[05:30] Rule of thumb: choose arrays when you need fast indexing and mostly append at the end. Choose linked lists when you frequently insert and remove in the middle and already have pointers to those positions, as in an LRU cache.`,
          },
        ],
      },
      {
        title: 'Sorting Algorithms',
        lectures: [
          {
            title: 'Sorting Algorithms - Part 1: Merge Sort',
            transcript: `[00:00] Sorting is one of the most studied problems in computer science. Let's start with merge sort, a clean example of the divide and conquer strategy.
[00:40] Divide and conquer has three steps. Divide the problem into smaller subproblems, conquer each subproblem recursively, and combine the results.
[01:25] Merge sort divides the array into two halves, recursively sorts each half, and then merges the two sorted halves into one sorted array.
[02:10] The merge step is the heart of the algorithm. Keep a pointer at the start of each sorted half, repeatedly copy the smaller of the two pointed-to elements into the output, and advance that pointer. Merging two halves of total length n takes O(n) time.
[03:20] How deep does the recursion go? Each level halves the array, so there are about log n levels. Each level does O(n) total merging work. That gives O(n log n) time in the best, average and worst case.
[04:30] Merge sort is stable: equal elements keep their original relative order. That matters when you sort records by one key after already sorting by another.
[05:15] Its main cost is memory. The standard array version needs O(n) extra space for the merge buffer, which is why in-place algorithms like quicksort are often preferred for arrays, while merge sort shines for linked lists and external sorting of huge files on disk.`,
          },
          {
            title: 'Sorting Algorithms - Part 2: Quicksort',
            transcript: `[00:00] Now let's study quicksort, which is usually the fastest general-purpose sorting algorithm in practice.
[00:45] Quicksort also uses divide and conquer, but it does the hard work before recursing. It chooses an element called the pivot and partitions the array so that everything smaller than the pivot ends up on its left and everything larger ends up on its right.
[02:00] After partitioning, the pivot is in its final sorted position. We then recursively quicksort the left part and the right part. No merge step is needed.
[03:30] The Lomuto partition scheme picks the last element as pivot and sweeps through the array, swapping smaller elements towards the front. The Hoare scheme uses two pointers moving towards each other and does fewer swaps.
[05:10] When the pivot splits the array into two roughly equal halves, the recursion depth is about log n and each level does O(n) partitioning work, so quicksort runs in O(n log n). This is its average case.
[08:30] The worst case appears when the pivot is always the smallest or largest element. Then one side of the partition is empty and the other has n minus 1 elements.
[14:02] This is exactly what happens on already sorted input if you always choose the first or last element as the pivot. Every partition peels off only one element, the recursion depth becomes n, and the total work is n plus n minus 1 plus n minus 2 and so on, which is O(n squared). That is why quicksort degrades to quadratic time on sorted input.
[16:20] The fix is to choose the pivot more carefully. Randomized pivot selection picks a random element, which makes the worst case extremely unlikely for any input. Median-of-three picks the median of the first, middle and last elements, which handles sorted and reverse-sorted input well.
[18:40] Quicksort sorts in place, needing only O(log n) stack space on average, and it has excellent cache performance. However, it is not stable. Many standard libraries use introsort, which starts with quicksort and switches to heapsort if the recursion gets too deep.`,
          },
        ],
      },
      {
        title: 'Searching & Trees',
        lectures: [
          {
            title: 'Binary Search',
            transcript: `[00:00] Binary search finds a target value in a sorted array in O(log n) time. The precondition matters: the array must be sorted.
[00:40] Keep two indices, low and high, that bound the region where the target could be. Look at the middle element. If it equals the target, you're done. If the target is smaller, discard the right half by moving high to mid minus 1. If the target is larger, move low to mid plus 1.
[01:50] Each comparison halves the search space, so after k steps only n divided by 2 to the k elements remain. That's why the number of steps is about log base 2 of n.
[02:40] A classic bug is integer overflow when computing the midpoint as low plus high divided by two. In languages with fixed-size integers, use low plus (high minus low) divided by two instead.
[03:30] Another common mistake is the loop condition. With inclusive bounds, loop while low is less than or equal to high; otherwise you may skip checking the last remaining element.
[04:20] Binary search is more general than looking up a value. You can binary search on the answer of any monotonic yes-or-no question, for example finding the first position where a condition becomes true, or the smallest capacity that lets you finish a task in time.`,
          },
          {
            title: 'Binary Search Trees',
            transcript: `[00:00] A binary search tree, or BST, is a binary tree with an ordering rule: for every node, all keys in its left subtree are smaller and all keys in its right subtree are larger.
[00:50] That rule lets us search like binary search. Start at the root, go left if the target is smaller, right if it is larger, and stop when you find it or reach an empty child.
[01:40] Insertion follows the same path as search and attaches the new key where the search ended. An in-order traversal, visiting left subtree, node, then right subtree, outputs the keys in sorted order.
[02:45] Search, insert and delete all take time proportional to the height of the tree. In a balanced tree the height is about log n, so these operations are O(log n).
[03:40] But a BST can become unbalanced. Inserting keys in sorted order produces a tree that is just a long chain, with height n, and operations degrade to O(n). Notice the parallel with quicksort on sorted input.
[04:35] Self-balancing trees such as AVL trees and red-black trees perform rotations after inserts and deletes to keep the height logarithmic. Most language libraries implement ordered maps using red-black trees.
[05:20] Deleting a node with two children is the tricky case: replace its key with its in-order successor, the smallest key in its right subtree, then delete that successor node instead.`,
          },
        ],
      },
      {
        title: 'Graphs',
        lectures: [
          {
            title: 'Graph Traversal: BFS and DFS',
            transcript: `[00:00] A graph is a set of vertices connected by edges. Graphs model road networks, social networks, dependencies between tasks and much more.
[00:45] We usually store a graph as an adjacency list: for each vertex, a list of its neighbours. This uses O(V plus E) space and is ideal for sparse graphs.
[01:30] Breadth-first search, or BFS, explores the graph level by level. Put the start vertex in a queue, then repeatedly take a vertex from the front of the queue and add its unvisited neighbours to the back.
[02:40] Because BFS visits vertices in order of their distance from the start, it finds shortest paths in unweighted graphs. Store each vertex's parent to reconstruct the path.
[03:35] Depth-first search, or DFS, goes as deep as possible before backtracking. It is naturally written with recursion, or with an explicit stack.
[04:30] DFS is the tool for detecting cycles, finding connected components and producing a topological sort of a directed acyclic graph, which orders tasks so that every task comes after its dependencies.
[05:20] Both BFS and DFS run in O(V plus E) time, because each vertex and edge is processed a constant number of times. Always keep a visited set; without it, cycles cause infinite loops.`,
          },
        ],
      },
    ],
  },
  {
    key: 'python',
    instructor: 'priya@vertexlearn.ai',
    title: 'Python for Data Science',
    description:
      'Go from zero to confident data analysis with Python. Learn the language essentials, then use NumPy, Pandas and Matplotlib to clean, analyse and visualise real datasets.',
    category: 'Data Science',
    difficulty: 'beginner',
    price: 0,
    status: 'approved',
    outcomes: ['Write clean Python with functions and comprehensions', 'Manipulate data with NumPy and Pandas', 'Create clear charts with Matplotlib'],
    modules: [
      {
        title: 'Python Essentials',
        lectures: [
          {
            title: 'Variables, Types and Control Flow',
            transcript: `[00:00] Python is popular in data science because it is readable and has a huge ecosystem of libraries. Let's start with the basics.
[00:35] A variable is a name that refers to a value. Python is dynamically typed, so you don't declare types; the value itself has a type, such as int, float, str or bool.
[01:20] Lists hold ordered, changeable collections. Dictionaries map keys to values and are perfect for looking things up by name. Tuples are like lists but cannot be changed after creation.
[02:15] Control flow decides which code runs. An if statement runs a block only when a condition is true, with elif and else for other cases. Indentation defines the block, so consistent indentation is required, not optional.
[03:05] A for loop iterates over any iterable, such as a list or the characters of a string. The range function produces a sequence of numbers for counting loops. A while loop repeats as long as its condition stays true.`,
          },
          {
            title: 'Functions and Comprehensions',
            transcript: `[00:00] Functions let you name a piece of logic and reuse it. Define one with def, give it parameters, and return a result.
[00:45] Parameters can have default values, which makes them optional for the caller. Keyword arguments let callers pass values by name, which makes calls easier to read.
[01:40] A list comprehension builds a new list from an iterable in a single expression, like squares equals x times x for x in numbers. You can add a condition to filter items, for example only the even numbers.
[02:35] Comprehensions are usually faster and clearer than building a list with append inside a loop. Dictionary and set comprehensions work the same way with curly braces.
[03:20] Keep functions small and focused on one task. A good function name describes what it returns, and a short docstring explains what it expects and why it exists.`,
          },
        ],
      },
      {
        title: 'NumPy & Pandas',
        lectures: [
          {
            title: 'NumPy Arrays and Vectorization',
            transcript: `[00:00] NumPy provides the ndarray, a fast fixed-type array that is the foundation of almost every scientific Python library.
[00:40] Unlike Python lists, NumPy arrays store numbers of one type in contiguous memory. Operations run in optimized C code instead of the Python interpreter.
[01:30] Vectorization means applying an operation to a whole array at once instead of looping. Multiplying an array by two multiplies every element, and it can be a hundred times faster than a Python loop.
[02:25] Broadcasting lets NumPy combine arrays of different shapes, for example adding a row of column means to every row of a matrix, by stretching the smaller array without copying data.
[03:15] Boolean indexing selects elements with a condition, such as all values greater than zero. Combined with vectorized maths, it lets you clean and transform data in a few readable lines.`,
          },
          {
            title: 'Pandas DataFrames',
            transcript: `[00:00] Pandas builds on NumPy to handle labelled, tabular data. Its main structure is the DataFrame: a table of columns, each with a name and a type.
[00:45] You usually start by loading data, for example with read_csv. Then inspect it with head, info and describe to understand the columns, the types and the missing values.
[01:40] Select columns by name and filter rows with boolean conditions. The loc accessor selects by labels and iloc selects by integer positions.
[02:35] Missing values appear as NaN. You can drop them with dropna or fill them with fillna, but think first: dropping rows can bias your analysis if values are not missing at random.
[03:30] The groupby operation splits data into groups, applies an aggregation such as mean or count, and combines the results. It answers questions like average sales per region in one line.`,
          },
        ],
      },
      {
        title: 'Visualization',
        lectures: [
          {
            title: 'Plotting with Matplotlib',
            transcript: `[00:00] Visualisation turns numbers into insight. Matplotlib is the core plotting library in Python, and Pandas plotting uses it under the hood.
[00:40] Create a figure and axes with plt.subplots, then call methods like plot for line charts, bar for bar charts, scatter for scatter plots and hist for histograms.
[01:35] Choose the chart for the question. Use a line chart for trends over time, a bar chart to compare categories, a histogram to see a distribution and a scatter plot to look for relationships between two variables.
[02:30] Always label your axes, include units and give the chart a title that states the takeaway. A reader should understand the chart without reading your code.
[03:15] Avoid clutter: remove unnecessary gridlines, use colour to highlight what matters and keep the number of series small enough to compare at a glance.`,
          },
        ],
      },
    ],
  },
  {
    key: 'ml',
    instructor: 'priya@vertexlearn.ai',
    title: 'Machine Learning Foundations',
    description:
      'Understand how machine learning really works. Learn the core ideas behind supervised learning, the bias-variance trade-off, gradient descent, decision trees and how to evaluate models honestly.',
    category: 'AI & Machine Learning',
    difficulty: 'intermediate',
    price: 1999,
    status: 'approved',
    outcomes: ['Explain supervised vs unsupervised learning', 'Train linear models with gradient descent', 'Evaluate models with cross-validation, precision and recall'],
    modules: [
      {
        title: 'What is Machine Learning?',
        lectures: [
          {
            title: 'Supervised vs Unsupervised Learning',
            transcript: `[00:00] Machine learning is the practice of learning patterns from data instead of writing explicit rules.
[00:40] In supervised learning, every training example comes with the correct answer, called a label. The model learns a mapping from inputs to labels. Predicting house prices is regression because the label is a number; detecting spam is classification because the label is a category.
[01:45] In unsupervised learning there are no labels. The model looks for structure on its own, for example clustering customers into groups with similar behaviour, or reducing many features to a few with dimensionality reduction.
[02:40] Reinforcement learning is a third paradigm, where an agent learns by taking actions and receiving rewards, as in game-playing systems.
[03:20] Most business problems start as supervised learning, because labelled historical data such as past purchases or past fraud cases is often available.`,
          },
          {
            title: 'The Bias-Variance Trade-off',
            transcript: `[00:00] Why do models fail on new data? The bias-variance trade-off gives us a way to think about it.
[00:45] Bias is error from wrong assumptions. A model with high bias is too simple, like fitting a straight line to curved data. It underfits: it performs poorly even on the training set.
[01:40] Variance is error from being too sensitive to the training data. A high-variance model, like a very deep decision tree, memorises noise. It overfits: training accuracy is excellent but test accuracy is poor.
[02:40] Increasing model complexity usually lowers bias and raises variance. The goal is the sweet spot with the lowest total error on unseen data.
[03:30] To reduce variance, gather more data, use regularisation, or average many models as random forests do. To reduce bias, use a more flexible model or better features.`,
          },
        ],
      },
      {
        title: 'Core Algorithms',
        lectures: [
          {
            title: 'Linear Regression and Gradient Descent',
            transcript: `[00:00] Linear regression predicts a number as a weighted sum of input features plus a bias term.
[00:40] We measure how wrong the model is with a loss function. For regression the usual choice is mean squared error: the average of the squared differences between predictions and true values.
[01:35] Gradient descent finds the weights that minimise the loss. The gradient points in the direction where the loss increases fastest, so we take a small step in the opposite direction and repeat.
[02:30] The learning rate controls the step size. Too small and training is painfully slow; too large and the loss bounces around or even diverges.
[03:20] Scaling features to similar ranges makes gradient descent converge much faster, because the loss surface becomes rounder instead of a long narrow valley.`,
          },
          {
            title: 'Decision Trees',
            transcript: `[00:00] A decision tree makes predictions by asking a sequence of yes-or-no questions about the features, like a flowchart.
[00:45] At each node the algorithm picks the split that makes the resulting groups as pure as possible. For classification, purity is measured with Gini impurity or entropy.
[01:40] Trees are easy to interpret and need little data preparation; they handle both numeric and categorical features and don't require scaling.
[02:30] Their weakness is overfitting. A tree grown until every leaf is pure memorises the training data. Limit the maximum depth or require a minimum number of samples per leaf.
[03:15] Ensembles fix this. Random forests average many trees trained on random subsets of the data, and gradient boosting adds trees one at a time, each correcting the errors of the previous ones.`,
          },
        ],
      },
      {
        title: 'Model Evaluation',
        lectures: [
          {
            title: 'Train/Test Splits and Cross-Validation',
            transcript: `[00:00] A model must be judged on data it has never seen. That's why we split data into a training set and a test set.
[00:40] Fit the model only on the training data and measure performance on the test set. If you tune choices using the test set, it stops being an honest estimate.
[01:35] Use a separate validation set, or cross-validation, for tuning. In k-fold cross-validation the data is divided into k folds; the model trains on k minus 1 folds and validates on the remaining one, rotating k times.
[02:30] Averaging the k scores gives a more reliable estimate than one split, especially with small datasets.
[03:10] Watch for data leakage: information from the test set, or from the future, sneaking into training features. Leakage produces great offline scores and terrible real-world performance.`,
          },
          {
            title: 'Precision, Recall and F1',
            transcript: `[00:00] Accuracy can be misleading. If only one percent of transactions are fraud, a model that always says not fraud is ninety-nine percent accurate and completely useless.
[00:45] Precision answers: of the cases the model flagged as positive, how many really were positive? Recall answers: of all the truly positive cases, how many did the model catch?
[01:45] There is a trade-off. Lowering the decision threshold catches more positives, raising recall, but also flags more false alarms, lowering precision.
[02:35] The F1 score is the harmonic mean of precision and recall. It is high only when both are reasonably high.
[03:15] Choose the metric from the cost of mistakes. In cancer screening, missing a case is costly, so prioritise recall. In spam filtering, losing a real email is costly, so prioritise precision.`,
          },
        ],
      },
    ],
  },
  {
    key: 'react',
    instructor: 'daniel@vertexlearn.ai',
    title: 'Modern Web Development with React',
    description:
      'Learn to build fast, maintainable user interfaces with React 18. Components, state, hooks and data fetching, taught with the patterns used in production apps.',
    category: 'Web Development',
    difficulty: 'beginner',
    price: 999,
    status: 'approved',
    outcomes: ['Build reusable components with JSX', 'Manage state and side effects with hooks', 'Fetch and cache server data with TanStack Query'],
    modules: [
      {
        title: 'React Fundamentals',
        lectures: [
          {
            title: 'Components and JSX',
            transcript: `[00:00] React builds user interfaces out of components: small, reusable functions that return a description of what should appear on screen.
[00:40] That description is written in JSX, which looks like HTML inside JavaScript. JSX compiles to function calls that create React elements.
[01:30] Components compose. A page component renders a header, a sidebar and a list, and each of those is its own component. This keeps each piece small and testable.
[02:20] Props are the inputs to a component, passed like HTML attributes. A component should treat its props as read-only.
[03:00] When rendering lists, give each item a stable key prop, usually an id. Keys let React match items between renders efficiently and keep their state attached to the right element.`,
          },
          {
            title: 'State and Props',
            transcript: `[00:00] State is data that changes over time and affects what a component renders. The useState hook returns the current value and a function to update it.
[00:45] Calling the setter schedules a re-render with the new value. Never modify state directly; always create a new object or array so React can detect the change.
[01:40] Lift state up when two components need the same data: move it to their closest common parent and pass it down as props, along with callbacks to change it.
[02:30] Derived values should be computed during render, not stored in separate state. Storing the same information twice leads to bugs when the copies drift apart.`,
          },
        ],
      },
      {
        title: 'Hooks in Depth',
        lectures: [
          {
            title: 'useEffect and Side Effects',
            transcript: `[00:00] Rendering should be pure. Anything that reaches outside the component, like subscriptions, timers or manual DOM changes, is a side effect and belongs in useEffect.
[00:50] The dependency array controls when the effect re-runs. Include every value from the component that the effect uses. An empty array means run once after the first render.
[01:45] Return a cleanup function to undo the effect, such as clearing an interval or removing an event listener. React runs it before the effect re-runs and when the component unmounts.
[02:40] Many effects aren't needed. If you're only transforming data for rendering, compute it directly; if you're responding to a user event, do the work in the event handler.`,
          },
          {
            title: 'Custom Hooks',
            transcript: `[00:00] A custom hook is a function whose name starts with use and that calls other hooks. It lets you share stateful logic between components.
[00:45] For example, a useDebounce hook can delay updating a search term until the user stops typing, so you don't fire a request on every keystroke.
[01:35] Each component that calls a custom hook gets its own independent state; hooks share logic, not data.
[02:20] Follow the rules of hooks: only call hooks at the top level of a component or another hook, never inside conditions or loops, so React can match state to the right hook on each render.`,
          },
        ],
      },
      {
        title: 'Working with Data',
        lectures: [
          {
            title: 'Fetching Data with TanStack Query',
            transcript: `[00:00] Server data is different from local UI state: it lives elsewhere, can change without you knowing and needs caching, retries and refetching.
[00:45] TanStack Query manages server state for you. useQuery takes a query key and a function that fetches the data, and returns the data along with loading and error states.
[01:40] The query key identifies the data in the cache. Components using the same key share one request and one cached result.
[02:35] useMutation handles writes such as creating or updating records. After a successful mutation, invalidate the related queries so they refetch fresh data.
[03:20] Stale time controls how long cached data is considered fresh. Tuning it avoids unnecessary network requests while keeping the UI up to date.`,
          },
        ],
      },
    ],
  },
  {
    key: 'sysdesign',
    instructor: 'rohit@vertexlearn.ai',
    title: 'System Design Fundamentals',
    description:
      'Learn how large-scale systems are built. Scaling, load balancing, caching, replication, sharding and message queues — explained with the trade-offs senior engineers weigh every day.',
    category: 'Computer Science',
    difficulty: 'advanced',
    price: 2499,
    status: 'approved',
    outcomes: ['Choose between vertical and horizontal scaling', 'Design caching and replication strategies', 'Use queues to decouple services'],
    modules: [
      {
        title: 'Scalability Basics',
        lectures: [
          {
            title: 'Horizontal vs Vertical Scaling',
            transcript: `[00:00] When traffic grows, a system must scale. There are two basic directions.
[00:40] Vertical scaling means giving one machine more CPU, memory or faster disks. It's simple, because the application doesn't change, but there is a hard ceiling and the single machine remains a single point of failure.
[01:35] Horizontal scaling means adding more machines and spreading the load across them. It can grow almost without limit and survives individual machine failures, but the application must be designed for it.
[02:30] The key requirement for horizontal scaling is statelessness: any server should be able to handle any request. Session data moves into a shared store such as Redis or into signed tokens like JWTs.`,
          },
          {
            title: 'Load Balancing',
            transcript: `[00:00] A load balancer sits in front of a pool of servers and distributes incoming requests among them.
[00:40] Round robin sends requests to servers in turn. Least connections sends each request to the server with the fewest active connections, which works better when requests vary in cost.
[01:35] Health checks let the load balancer stop routing traffic to servers that are failing, which is how horizontally scaled systems tolerate individual crashes.
[02:25] Layer 4 load balancers route by IP and port and are very fast. Layer 7 load balancers understand HTTP, so they can route by path or header and terminate TLS.`,
          },
        ],
      },
      {
        title: 'The Data Layer',
        lectures: [
          {
            title: 'Caching Strategies',
            transcript: `[00:00] Caching stores the results of expensive operations so they can be served quickly next time. It's often the single biggest performance win.
[00:45] In the cache-aside pattern, the application first checks the cache. On a miss it reads from the database, stores the result in the cache with a time-to-live, and returns it.
[01:40] The hard part is invalidation. When the underlying data changes, cached copies become stale. Common approaches are short TTLs, or deleting the cache key whenever the data is updated.
[02:35] Watch out for a cache stampede: when a popular key expires, thousands of requests hit the database at once. Locks or staggered expiry times prevent this.`,
          },
          {
            title: 'Database Replication and Sharding',
            transcript: `[00:00] As data and traffic grow, one database server becomes a bottleneck.
[00:40] Replication copies data from a primary to one or more replicas. Writes go to the primary; reads can be spread across replicas. Replicas also provide failover if the primary dies.
[01:35] With asynchronous replication, replicas lag slightly behind, so a user might not immediately see their own write. Reading your own writes from the primary avoids this.
[02:30] Sharding splits data across multiple databases by a shard key, such as user id. Each shard holds a subset of rows, so both storage and write load are divided.
[03:20] Choosing the shard key is critical. A poor key creates hot shards, and queries that span shards become slow and complex.`,
          },
        ],
      },
      {
        title: 'Asynchronous Processing',
        lectures: [
          {
            title: 'Message Queues and Background Jobs',
            transcript: `[00:00] Not every task needs to finish before you reply to the user. Sending emails, generating PDFs or processing uploaded videos can happen in the background.
[00:45] A message queue decouples producers from consumers. The web server adds a job to the queue and responds immediately; worker processes take jobs from the queue and process them.
[01:40] Queues absorb traffic spikes, because jobs wait instead of overloading downstream services, and workers can be scaled independently.
[02:35] Design jobs to be idempotent, so processing the same job twice has no extra effect. Retries with exponential backoff handle temporary failures, and a dead-letter queue keeps jobs that keep failing for inspection.`,
          },
        ],
      },
    ],
  },
  {
    key: 'uiux',
    instructor: 'daniel@vertexlearn.ai',
    title: 'UI/UX Design Principles',
    description:
      'Design interfaces people love to use. Learn visual hierarchy, colour and contrast, user research and prototyping — the foundations every product designer and developer should know.',
    category: 'Design',
    difficulty: 'beginner',
    price: 0,
    status: 'approved',
    outcomes: ['Apply visual hierarchy and spacing', 'Choose accessible colour palettes', 'Run lightweight user research and prototype ideas'],
    modules: [
      {
        title: 'Design Foundations',
        lectures: [
          {
            title: 'Visual Hierarchy',
            transcript: `[00:00] Visual hierarchy is the order in which the eye notices things on a screen. Good hierarchy makes the most important element obvious at a glance.
[00:40] Size, weight and colour create emphasis. A large, bold heading is read before body text. Use emphasis sparingly; if everything is bold, nothing stands out.
[01:30] Whitespace groups related elements and separates unrelated ones. Consistent spacing on a scale, such as multiples of four or eight pixels, makes layouts feel calm and intentional.
[02:20] Alignment creates order. Elements aligned to a shared grid look related and are easier to scan.`,
          },
          {
            title: 'Color and Contrast',
            transcript: `[00:00] Colour communicates meaning and brand, but it must stay readable.
[00:40] WCAG requires a contrast ratio of at least 4.5 to 1 for normal body text and 3 to 1 for large text. Low contrast grey text on white is one of the most common accessibility failures.
[01:35] Never use colour as the only way to convey information. Pair a red error state with an icon and a message, so people with colour vision deficiency still understand it.
[02:25] Build a palette with one primary brand colour, neutrals for text and surfaces, and semantic colours for success, warning and error. Define each as a token so light and dark themes stay consistent.`,
          },
        ],
      },
      {
        title: 'The UX Process',
        lectures: [
          {
            title: 'User Research Basics',
            transcript: `[00:00] User research replaces assumptions with evidence about what people actually need.
[00:40] Interviews explore goals, motivations and frustrations. Ask about past behaviour, such as tell me about the last time you did this, rather than asking people to predict the future.
[01:35] Usability testing watches real users attempt real tasks with your design. Five participants typically reveal most of the major usability problems.
[02:25] Synthesise findings into patterns and turn them into clear problem statements before jumping to solutions.`,
          },
          {
            title: 'Wireframing and Prototyping',
            transcript: `[00:00] Wireframes are low-fidelity layouts that focus on structure and content, not colours or polish. They're fast to make and cheap to throw away.
[00:45] Prototypes add interaction so people can click through a flow. Low-fidelity prototypes test the flow; high-fidelity prototypes test details like copy and visual design.
[01:40] Iterate quickly: sketch, test with users, learn and refine. Finding a problem in a prototype costs minutes; finding it after launch costs weeks.`,
          },
        ],
      },
    ],
  },
  // ---- Courses awaiting admin review ----
  {
    key: 'graphs-adv',
    instructor: 'rohit@vertexlearn.ai',
    title: 'Advanced Graph Algorithms',
    description: "Shortest paths, minimum spanning trees, network flow and strongly connected components, with competitive-programming style problem solving.",
    category: 'Computer Science',
    difficulty: 'advanced',
    price: 1799,
    status: 'pending',
    outcomes: ["Implement Dijkstra's and Bellman-Ford", 'Build minimum spanning trees', 'Solve max-flow problems'],
    modules: [
      {
        title: 'Shortest Paths',
        lectures: [
          {
            title: "Dijkstra's Algorithm",
            transcript: `[00:00] Dijkstra's algorithm finds shortest paths from one source in a graph with non-negative edge weights.
[00:45] It keeps a priority queue of vertices ordered by their best known distance, repeatedly removes the closest vertex and relaxes its outgoing edges.
[01:40] With a binary heap it runs in O((V plus E) log V). It fails with negative edges; use Bellman-Ford for those.`,
          },
        ],
      },
    ],
  },
  {
    key: 'pytorch',
    instructor: 'priya@vertexlearn.ai',
    title: 'Deep Learning with PyTorch',
    description: 'Build and train neural networks with PyTorch: tensors, autograd, training loops, CNNs and transfer learning.',
    category: 'AI & Machine Learning',
    difficulty: 'advanced',
    price: 2999,
    status: 'pending',
    outcomes: ['Write PyTorch training loops', 'Train CNNs for image classification', 'Apply transfer learning'],
    modules: [
      {
        title: 'Tensors and Autograd',
        lectures: [
          {
            title: 'Tensors and Automatic Differentiation',
            transcript: `[00:00] Tensors are PyTorch's core data structure: multi-dimensional arrays that can live on a GPU.
[00:45] Autograd records operations on tensors that require gradients and computes derivatives automatically when you call backward on the loss.
[01:35] A training loop computes predictions, the loss, gradients with backward, then updates weights with an optimizer step, and zeroes gradients before the next batch.`,
          },
        ],
      },
    ],
  },
  {
    key: 'blockchain',
    instructor: 'daniel@vertexlearn.ai',
    title: 'Intro to Blockchain',
    description: 'A quick look at blockchains.',
    category: 'Computer Science',
    difficulty: 'beginner',
    price: 499,
    status: 'rejected',
    outcomes: [],
    modules: [{ title: 'Overview', lectures: [{ title: 'What is a blockchain?', transcript: '[00:00] A blockchain is a shared, append-only ledger.' }] }],
  },
];
