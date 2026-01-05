#include <Arduino.h>

class Map {
  private:
    int width, height;
    char **map;
    int **dist; 

    void placeObstacleBlocks() {
      bool placed = false;
      while (!placed) {
        int startX = random(0, width - 1);
        int startY = random(0, height - 1);
        int orientation = random(0, 4);
        bool canPlace = true;

        if (orientation == 0 && startX + 3 < width) {
            for (int i = 0; i < 4; ++i) if (map[startY][startX + i] != ' ') canPlace = false;
        } else if (orientation == 1 && startY + 3 < height) {
            for (int i = 0; i < 4; ++i) if (map[startY + i][startX] != ' ') canPlace = false;
        } else if (orientation == 2 && startX + 3 < width && startY + 3 < height) {
            for (int i = 0; i < 4; ++i) if (map[startY + i][startX + i] != ' ') canPlace = false;
        } else if (orientation == 3 && startX - 3 >= 0 && startY + 3 < height) {
            for (int i = 0; i < 4; ++i) if (map[startY + i][startX - i] != ' ') canPlace = false;
        } else { canPlace = false; }

        if (canPlace) {
          for (int i = 0; i < 4; ++i) {
            if (orientation == 0) map[startY][startX + i] = '#';
            else if (orientation == 1) map[startY + i][startX] = '#';
            else if (orientation == 2) map[startY + i][startX + i] = '#';
            else if (orientation == 3) map[startY + i][startX - i] = '#';
          }
          placed = true;
        }
      }
    }

    struct Queue {
      int front, rear, queueSize;
      int (*data)[2];
      Queue(int maxSize) {
        queueSize = maxSize;
        front = rear = 0;
        data = new int[maxSize][2];
      }
      ~Queue() { delete[] data; }
      bool isEmpty() { return front == rear; }
      void enqueue(int x, int y) { data[rear][0] = x; data[rear][1] = y; rear = (rear + 1) % queueSize; }
      void dequeue(int &x, int &y) { x = data[front][0]; y = data[front][1]; front = (front + 1) % queueSize; }
    };

    // Die 8 Bewegungsrichtungen (Horizontal, Vertikal, Diagonal)
    const int dx[8] = {1, -1, 0, 0, 1, 1, -1, -1};
    const int dy[8] = {0, 0, 1, -1, 1, -1, 1, -1};

  public:
    Map(int w, int h) : width(w), height(h) {
      map = new char*[height];
      dist = new int*[height];
      for (int i = 0; i < height; ++i) {
        map[i] = new char[width];
        dist[i] = new int[width];
      }
      initializeMap();
    }

    ~Map() {
      for (int i = 0; i < height; ++i) {
        delete[] map[i]; delete[] dist[i];
      }
      delete[] map; delete[] dist;
    }

    void initializeMap() {
      for (int i = 0; i < height; ++i) {
        for (int j = 0; j < width; ++j) {
          map[i][j] = ' ';
          dist[i][j] = -1;
        }
      }
    }

    void generateRandomMap(byte obstacleCount = 4) {
      initializeMap();
      for (int i = 0; i < obstacleCount; ++i) placeObstacleBlocks();
      map[random(0, height)][random(0, width)] = 'S';
      int gx, gy;
      do { gx = random(0, width); gy = random(0, height); } while (map[gy][gx] != ' ');
      map[gy][gx] = 'G';
    }

    void printMap() {
      Serial.print('+');
      for (int j = 0; j < width; ++j) Serial.print("-");
      Serial.println('+');
      for (int i = 0; i < height; ++i) {
        Serial.print('|');
        for (int j = 0; j < width; ++j) Serial.print(map[i][j]);
        Serial.println('|');
      }
      Serial.print('+');
      for (int j = 0; j < width; ++j) Serial.print("-");
      Serial.println('+');
    }

    void fillWithNumbers() {
      int startX = -1, startY = -1;
      for (int i = 0; i < height; ++i) {
        for (int j = 0; j < width; ++j) {
          dist[i][j] = -1;
          if (map[i][j] == 'S') { startX = j; startY = i; }
        }
      }
      if (startX == -1) return;

      Queue q(width * height);
      q.enqueue(startX, startY);
      dist[startY][startX] = 0;

      while (!q.isEmpty()) {
        int x, y;
        q.dequeue(x, y);
        for (int d = 0; d < 8; d++) { // Jetzt 8 Richtungen
          int nx = x + dx[d], ny = y + dy[d];
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && dist[ny][nx] == -1) {
            if (map[ny][nx] == ' ' || map[ny][nx] == 'G') {
              dist[ny][nx] = dist[y][x] + 1;
              if (map[ny][nx] == ' ') map[ny][nx] = (dist[ny][nx] % 10) + '0';
              q.enqueue(nx, ny);
            }
          }
        }
      }
    }

    void findShortestPath() {
      int gx = -1, gy = -1;
      for (int i = 0; i < height; ++i) {
        for (int j = 0; j < width; ++j) {
          if (map[i][j] == 'G') { gx = j; gy = i; break; }
        }
      }
      if (gx == -1 || dist[gy][gx] == -1) return;

      // Zahlen entfernen
      for (int i = 0; i < height; ++i) {
        for (int j = 0; j < width; ++j) if (map[i][j] >= '0' && map[i][j] <= '9') map[i][j] = ' ';
      }

      int currX = gx, currY = gy;
      while (dist[currY][currX] != 0) {
        for (int d = 0; d < 8; d++) { // Jetzt 8 Richtungen zurückverfolgen
          int nx = currX + dx[d], ny = currY + dy[d];
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && dist[ny][nx] == dist[currY][currX] - 1) {
            currX = nx; currY = ny;
            if (map[currY][currX] != 'S') map[currY][currX] = '.';
            break;
          }
        }
      }
    }
};

Map myMap(30, 10);

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  
  for (byte i = 0; i < 3; i++) {
    Serial.println("\n--- Map mit Diagonalsuche ---");
    myMap.generateRandomMap(6);
    myMap.printMap();
    myMap.fillWithNumbers();
    myMap.printMap();
    myMap.findShortestPath();
    myMap.printMap();
    delay(2000);
  }
}

void loop() {}