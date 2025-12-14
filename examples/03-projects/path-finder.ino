#include <Arduino.h>

class Map {
  private:
    int width, height;
    char **map; // 2D-array for the map

    // Helper method to place blocks of four connected obstacles
    void placeObstacleBlocks() {
      bool placed = false;

      while (!placed) {
        int startX = random(0, width - 1);
        int startY = random(0, height - 1);
        int orientation = random(0, 4); // 0: horizontal, 1: vertical, 2: diagonal-right, 3: diagonal-left

        bool canPlace = true;
        // Check if the area is free and there is space for the block
        switch (orientation) {
          case 0: // Horizontal
            if (startX + 3 < width) {
              for (int i = 0; i < 4; ++i) {
                if (map[startY][startX + i] != ' ') {
                  canPlace = false;
                  break;
                }
              }
            } else {
              canPlace = false;
            }
            break;

          case 1: // Vertical
            if (startY + 3 < height) {
              for (int i = 0; i < 4; ++i) {
                if (map[startY + i][startX] != ' ') {
                  canPlace = false;
                  break;
                }
              }
            } else {
              canPlace = false;
            }
            break;

          case 2: // Diagonal-right
            if (startX + 3 < width && startY + 3 < height) {
              for (int i = 0; i < 4; ++i) {
                if (map[startY + i][startX + i] != ' ') {
                  canPlace = false;
                  break;
                }
              }
            } else {
              canPlace = false;
            }
            break;

          case 3: // Diagonal-left
            if (startX - 3 >= 0 && startY + 3 < height) {
              for (int i = 0; i < 4; ++i) {
                if (map[startY + i][startX - i] != ' ') {
                  canPlace = false;
                  break;
                }
              }
            } else {
              canPlace = false;
            }
            break;
        }

        if (canPlace) {
          // Place the four obstacles
          switch (orientation) {
            case 0: // Horizontal
              for (int i = 0; i < 4; ++i) {
                map[startY][startX + i] = '#';
              }
              break;

            case 1: // Vertical
              for (int i = 0; i < 4; ++i) {
                map[startY + i][startX] = '#';
              }
              break;

            case 2: // Diagonal-right
              for (int i = 0; i < 4; ++i) {
                map[startY + i][startX + i] = '#';
              }
              break;

            case 3: // Diagonal-left
              for (int i = 0; i < 4; ++i) {
                map[startY + i][startX - i] = '#';
              }
              break;
          }
          placed = true;
        }
      }
    }

    // Helper method to check if a field is valid
    bool isValid(int x, int y) {
      return (x >= 0 && x < width && y >= 0 && y < height && (map[y][x] == ' ' || map[y][x] == 'G'));
    }

    // Custom implementation of a simple queue for the flood-fill algorithm
    struct Queue {
      int front, rear;
      int queueSize;
      int (*data)[2]; // Array of 2D pairs (x, y)

      // Constructor to initialize the queue
      Queue(int maxSize) {
        queueSize = maxSize;
        front = rear = 0;
        data = new int[maxSize][2]; // 2D-array to store the coordinates
      }

      ~Queue() {
        delete[] data;
      }

      bool isEmpty() {
        return front == rear;
      }

      void enqueue(int x, int y) {
        data[rear][0] = x;
        data[rear][1] = y;
        rear = (rear + 1) % queueSize;
      }

      void dequeue(int &x, int &y) {
        x = data[front][0];
        y = data[front][1];
        front = (front + 1) % queueSize;
      }
    };

  public:
    // Constructor to initialize the map with dimensions
    Map(int w, int h) {
      width = w;
      height = h;

      // Allocate memory for the map
      map = new char*[height];
      for (int i = 0; i < height; ++i) {
        map[i] = new char[width];
      }

      // Initialize map
      initializeMap();
    }

    // Destructor to free memory
    ~Map() {
      for (int i = 0; i < height; ++i) {
        delete[] map[i];
      }
      delete[] map;
    }

    // Method to initialize the map
    void initializeMap() {
      for (int i = 0; i < height; ++i) {
        for (int j = 0; j < width; ++j) {
          map[i][j] = ' '; // Initialize everything as open node
        }
      }
    }

    // Method to generate a random map
    void generateRandomMap(byte obstacleCount = 4) {
      initializeMap();

      // Place multiple blocks of four connected obstacles
      for (int i = 0; i < obstacleCount; ++i) {
        placeObstacleBlocks();
      }

      // Set random start and goal positions
      map[random(0, height)][random(0, width)] = 'S'; // Start
      map[random(0, height)][random(0, width)] = 'G'; // Goal
    }

    // Method to print the map to the serial console
    void printMap() {
      // Top border
      Serial.print('+');
      for (int j = 0; j < width; ++j) {
        Serial.print("-"); // One character per column
      }
      Serial.println('+');

      // Map content
      for (int i = 0; i < height; ++i) {
        Serial.print('|');
        for (int j = 0; j < width; ++j) {
          Serial.print(map[i][j]); // No spaces between characters
        }
        Serial.println('|');
      }

      // Bottom border
      Serial.print('+');
      for (int j = 0; j < width; ++j) {
        Serial.print("-"); // One character per column
      }
      Serial.println('+');
    }

    // Method to fill the map with numbers starting from the 'S' position
    void fillWithNumbers() {
      // Find the start position 'S'
      int startX = -1, startY = -1;
      for (int i = 0; i < height; ++i) {
        for (int j = 0; j < width; ++j) {
          if (map[i][j] == 'S') {
            startX = j;
            startY = i;
            break;
          }
        }
        if (startX != -1) break; // If start point is found
      }

      if (startX == -1 || startY == -1) return; // No start point found

      // Create a custom queue with maximum size (e.g. width * height)
      Queue q(width * height);
      q.enqueue(startX, startY);
      int distance = 1;

      // Movement directions (right, left, up, down)
      int dx[] = {1, -1, 0, 0};
      int dy[] = {0, 0, 1, -1};

      // While the queue is not empty
      bool goalReached = false;
      while (!q.isEmpty() && !goalReached) {
        int size = (q.rear - q.front + width * height) % (width * height);
        for (int i = 0; i < size; ++i) {
          int x, y;
          q.dequeue(x, y);

          // Go to all adjacent fields
          for (int d = 0; d < 4; ++d) {
            int newX = x + dx[d];
            int newY = y + dy[d];

            // Check if the new field is valid
            if (isValid(newX, newY)) {
              if (map[newY][newX] == 'G') {
                goalReached = true;
                break; // End search when goal is reached
              }

              map[newY][newX] = '0' + distance; // Convert number to character
              q.enqueue(newX, newY);
            }
          }

          if (goalReached) break; // Exit loop when goal is found
        }
        distance++;
      }
    }
};

// Global map instance
Map myMap(30, 10);

void setup() {
  Serial.begin(9600);
  for (byte i = 0; i < 5; i++)
  {
    // Generate random map
    myMap.generateRandomMap();
    myMap.printMap();

    // Fill the map with numbers starting from 'S'
    myMap.fillWithNumbers();
    myMap.printMap();
  }
}

void loop() {
  // No code needed in the endless loop
}
